import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/install-dynamic-plugins.cjs',
  // Minify the production bundle to reduce cold-start parse cost in the
  // init container. The external sourcemap (committed alongside the .cjs)
  // is what `node --enable-source-maps` consumes if a stack trace needs to
  // be unminified during debugging.
  minify: true,
  sourcemap: 'external',
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'external',
  logLevel: 'info',
});
