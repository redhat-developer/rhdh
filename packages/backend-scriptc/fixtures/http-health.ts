/**
 * PROTOTYPE fixture — static-friendly health HTTP server.
 * Mirrors the thinnest RHDH backend surface: listen, route, JSON, env.
 */
import * as http from 'http';

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

const port = resolvePort();

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/healthcheck' || url === '/.backstage/health/v1/liveness') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  if (url === '/meta') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        service: 'prototype-scriptc-http-health',
        runtime: process.argv.length > 1 ? process.argv[1] : 'unknown',
      }),
    );
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
