import express from 'express';

import { createServer, type Server } from 'node:http';

import {
  addFetchPriorityToDeferScripts,
  appHtmlFetchPriorityMiddleware,
} from './appHtmlFetchPriority';

async function startServer(app: express.Express): Promise<{
  server: Server;
  base: string;
}> {
  const server = createServer(app);
  await new Promise<void>(resolve => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  return {
    server,
    base: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
  };
}

function createApp(body: string | object | Buffer, contentType = 'text/html') {
  const app = express();
  app.use(appHtmlFetchPriorityMiddleware);
  app.get('/', (_req, res) => {
    res.status(200).set('Content-Type', contentType).send(body);
  });
  return app;
}

const APP_HTML = `<!doctype html>
<html lang="en">
  <head>
    <script
      defer
      fetchpriority="high"
      src="/.backstage/dynamic-features-preload/preload.js"
    ></script>
    <script defer src="/static/runtime.76f76f358257.js"></script>
    <script defer="defer" src="/static/main.46883497d9c7.js"></script>
    <script src="/static/sync-parser-blocking.js"></script>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`;

describe('addFetchPriorityToDeferScripts', () => {
  it('adds fetchpriority="high" to defer script tags in all shapes', () => {
    const { html, rewritten } = addFetchPriorityToDeferScripts(APP_HTML);

    expect(rewritten).toBe(2);
    expect(html).toContain(
      '<script defer src="/static/runtime.76f76f358257.js" fetchpriority="high">',
    );
    expect(html).toContain(
      '<script defer="defer" src="/static/main.46883497d9c7.js" fetchpriority="high">',
    );
  });

  it('leaves tags already carrying fetchpriority and non-defer scripts untouched', () => {
    const { html } = addFetchPriorityToDeferScripts(APP_HTML);

    // preload.js tag (pretty-printed, already high priority) — exactly once
    expect(
      html.match(/fetchpriority="high"\s*\n\s*src="\/\.backstage/g),
    ).toHaveLength(1);
    // Parser-blocking script without defer is untouched
    expect(html).toContain(
      '<script src="/static/sync-parser-blocking.js"></script>',
    );
  });

  it('is idempotent', () => {
    const once = addFetchPriorityToDeferScripts(APP_HTML);
    const twice = addFetchPriorityToDeferScripts(once.html);

    expect(twice.rewritten).toBe(0);
    expect(twice.html).toBe(once.html);
  });

  it('reports zero rewrites for bodies without defer scripts', () => {
    const { html, rewritten } = addFetchPriorityToDeferScripts(
      '<html><body><p>No scripts here</p></body></html>',
    );

    expect(rewritten).toBe(0);
    expect(html).toBe('<html><body><p>No scripts here</p></body></html>');
  });
});

describe('appHtmlFetchPriorityMiddleware', () => {
  it('rewrites defer scripts in served HTML responses', async () => {
    const { server, base } = await startServer(createApp(APP_HTML));
    try {
      const res = await fetch(`${base}/`);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(
        '<script defer src="/static/runtime.76f76f358257.js" fetchpriority="high">',
      );
      // Content-Length matches the rewritten body
      expect(res.headers.get('content-length')).toBe(
        String(Buffer.byteLength(text)),
      );
    } finally {
      server.close();
    }
  });

  it('rewrites Buffer bodies (how the app-backend sends the templated index)', async () => {
    const { server, base } = await startServer(
      createApp(Buffer.from(APP_HTML, 'utf8')),
    );
    try {
      const res = await fetch(`${base}/`);

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(
        '<script defer="defer" src="/static/main.46883497d9c7.js" fetchpriority="high">',
      );
      expect(text).not.toContain(
        '<script defer="defer" src="/static/main.46883497d9c7.js"></script>',
      );
    } finally {
      server.close();
    }
  });

  it('passes non-HTML responses through unchanged', async () => {
    const { server, base } = await startServer(
      createApp('{"remotes":[]}', 'application/json'),
    );
    try {
      const res = await fetch(`${base}/`);

      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('{"remotes":[]}');
    } finally {
      server.close();
    }
  });

  it('passes object bodies through unchanged', async () => {
    // Realistic JSON response: express routes res.send(object) through
    // res.json, which re-enters the wrapped send with the stringified
    // body — under application/json it skips the HTML rewrite.
    const { server, base } = await startServer(
      createApp({ ok: true }, 'application/json'),
    );
    try {
      const res = await fetch(`${base}/`);

      expect(res.status).toBe(200);
      await expect(res.text()).resolves.toBe('{"ok":true}');
    } finally {
      server.close();
    }
  });

  it('serves HTML without matching tags unchanged (and warns once)', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
    try {
      const first = await startServer(
        createApp('<html><body>no scripts</body></html>'),
      );
      const second = await startServer(
        createApp('<html><body>no scripts</body></html>'),
      );
      try {
        const res1 = await fetch(`${first.base}/`);
        const res2 = await fetch(`${second.base}/`);

        expect(res1.status).toBe(200);
        await expect(res1.text()).resolves.toBe(
          '<html><body>no scripts</body></html>',
        );
        await expect(res2.text()).resolves.toBe(
          '<html><body>no scripts</body></html>',
        );
        expect(warnSpy).toHaveBeenCalledTimes(1);
      } finally {
        first.server.close();
        second.server.close();
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});
