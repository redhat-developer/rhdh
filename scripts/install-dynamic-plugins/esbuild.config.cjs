'use strict';

const esbuild = require('esbuild');
const path = require('path');

esbuild
  .build({
    entryPoints: [path.join(__dirname, 'dist', 'cli.js')],
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    outfile: path.join(__dirname, 'dist', 'install-dynamic-plugins.cjs'),
    banner: {
      js: '#!/usr/bin/env node\n'
    },
    sourcemap: true,
    logLevel: 'info'
  })
  .catch(() => process.exit(1));
