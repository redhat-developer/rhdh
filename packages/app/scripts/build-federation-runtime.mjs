#!/usr/bin/env node
/*
 * Copyright (c) Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0.
 */

/**
 * Bundle `src/federation-runtime-entry.ts` into `public/federation-runtime.js`.
 *
 * Remotes built with Module Federation `experiments.externalRuntime` read
 * `globalThis._FEDERATION_RUNTIME_CORE`. That global must exist before
 * `preload.js` injects remoteEntry scripts — so this file is emitted as a
 * static asset and loaded synchronously from index.html ahead of preload.js.
 */

import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

await esbuild.build({
  entryPoints: [path.join(appRoot, "src/federation-runtime-entry.ts")],
  bundle: true,
  outfile: path.join(appRoot, "public/federation-runtime.js"),
  format: "iife",
  platform: "browser",
  target: ["es2020"],
  minify: true,
  logLevel: "info",
});
