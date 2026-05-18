#!/usr/bin/env node
/**
 * yarn-lockfile-surgeon
 *
 * Surgically bumps packages in a Yarn Berry (v3+) lockfile to their minimum
 * satisfying versions, without re-resolving unrelated transitive dependencies.
 *
 * Unlike `yarn up` or `yarn install`, this tool resolves new ranges to the
 * LOWEST version that satisfies them — not the latest — keeping the lockfile
 * as close to the original as possible.
 *
 * Usage:
 *   yarn dlx yarn-lockfile-surgeon <lockfile> <pkg@version> [<pkg@version> ...]
 *
 * Example:
 *   yarn dlx yarn-lockfile-surgeon yarn.lock \
 *     @scope/package-a@1.2.3 \
 *     @scope/package-b@4.5.6
 *
 * After running, execute `yarn install --mode=update-lockfile` to fill in
 * checksums without re-resolving dependencies.
 */

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { structUtils } from "@yarnpkg/core";
import { bumpLockfile } from "./lib.ts";
import { createNpmFetcher } from "./registry.ts";

const USAGE = `Usage: yarn-lockfile-surgeon [--help] <lockfile> <pkg@version> [<pkg@version> ...]

Example:
  yarn-lockfile-surgeon yarn.lock @scope/package@1.2.3`;

const { values, positionals } = parseArgs({
  options: {
    help: { type: "boolean", short: "h", default: false },
  },
  allowPositionals: true,
});

const [lockfileArg, ...targetArgs] = positionals;

if (values.help || !lockfileArg || targetArgs.length === 0) {
  console.error(USAGE);
  process.exit(values.help ? 0 : 1);
}

const lockfilePath = resolve(lockfileArg);
const targets = targetArgs.map((arg) => structUtils.parseDescriptor(arg));

console.log("🔪 Yarn Lockfile Surgeon — minimum-version strategy\n");
console.log(`Lockfile: ${lockfilePath}`);
console.log(
  `Targets:  ${targets.map((t) => structUtils.stringifyDescriptor(t)).join(", ")}`,
);

await bumpLockfile(lockfilePath, targets, createNpmFetcher());
