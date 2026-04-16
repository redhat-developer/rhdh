import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  outfile: 'dist/install-dynamic-plugins.cjs',
  minify: false,
  sourcemap: false,
  banner: { js: '#!/usr/bin/env node' },
  legalComments: 'external',
  logLevel: 'info',
});
