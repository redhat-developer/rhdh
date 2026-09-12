/**
 * PROTOTYPE fixture — HTTP server that pulls one npm dependency.
 * Forces --dynamic on scriptc (npm JS runs in the embedded island).
 */
import * as http from 'http';
import { basename } from 'path';
import { z } from 'zod';

const HealthSchema = z.object({
  status: z.literal('ok'),
  path: z.string(),
});

function resolvePort(): number {
  if (process.argv.length > 2) {
    return Number(process.argv[2]);
  }
  const fromEnv = process.env.PORT;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) {
    return Number(fromEnv);
  }
  return 7008;
}

const port = resolvePort();

const server = http.createServer((req, res) => {
  const url = req.url ?? '/';
  if (url === '/healthcheck') {
    const body = HealthSchema.parse({
      status: 'ok',
      path: basename(url),
    });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(port, '127.0.0.1', () => {
  console.log(`listening on http://127.0.0.1:${port}`);
});
