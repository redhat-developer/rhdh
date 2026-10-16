/**
 * PROTOTYPE — trimmed RHDH-shaped entry for a Linux ScriptC container.
 * Not the full backend: no dynamic plugins, OTel, SQLite, scaffolder, etc.
 */
import * as http from 'http';
import { z } from 'zod';

const InfoQuerySchema = z.object({
  echo: z.string().optional(),
});

function resolvePort(): number {
  if (process.argv.length > 2) {
    return Number(process.argv[2]);
  }
  const fromEnv = process.env.PORT;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return Number(fromEnv);
  }
  return 7007;
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function parseQuery(url: string): Record<string, string> {
  const qIndex = url.indexOf('?');
  if (qIndex < 0) {
    return {};
  }
  const out: Record<string, string> = {};
  const raw = url.slice(qIndex + 1);
  for (const part of raw.split('&')) {
    if (part.length === 0) {
      continue;
    }
    const eq = part.indexOf('=');
    if (eq < 0) {
      out[decodeURIComponent(part)] = '';
    } else {
      out[decodeURIComponent(part.slice(0, eq))] = decodeURIComponent(
        part.slice(eq + 1),
      );
    }
  }
  return out;
}

function pathOnly(url: string): string {
  const q = url.indexOf('?');
  return q < 0 ? url : url.slice(0, q);
}

const port = resolvePort();
const host = '0.0.0.0';

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  const path = pathOnly(url);

  if (path === '/healthcheck' || path === '/.backstage/health/v1/liveness') {
    sendJson(res, 200, { status: 'ok' });
    return;
  }

  if (path === '/api/poc/info') {
    const parsed = InfoQuerySchema.safeParse(parseQuery(url));
    if (!parsed.success) {
      sendJson(res, 400, { error: 'invalid query' });
      return;
    }
    sendJson(res, 200, {
      service: 'rhdh-backend-scriptc',
      runtime: process.argv.length > 1 ? process.argv[1] : 'unknown',
      echo: parsed.data.echo ?? null,
      note: 'trimmed PoC — packages/backend-scriptc, not packages/backend',
    });
    return;
  }

  sendJson(res, 404, { error: 'not found' });
});

server.listen(port, host, () => {
  console.log(`listening on http://${host}:${port}`);
});
