/**
 * Module Resolution Patch
 *
 * Extends Node.js module resolution so extracted OCI plugins can find peer
 * dependencies (e.g. @backstage/backend-plugin-api) from the test package's
 * node_modules.
 *
 * This is necessary because dynamic plugins extracted from OCI images don't
 * have their own node_modules - they rely on the host's dependencies.
 */

import { resolve } from "path";
import Module from "node:module";

/**
 * Patch Node.js module resolution to include test package node_modules
 *
 * NOTE: Uses Node.js internal API `Module._nodeModulePaths` which is
 * undocumented but stable. Tested with Node 22.
 *
 * If this breaks in a future Node version, the test will fail with
 * "Cannot find module" errors. The fix would be to use NODE_PATH env var instead.
 */
export function patchModuleResolution(extraNodeModulesPath: string): void {
  const nodeModule = Module as unknown as {
    _nodeModulePaths: (...args: unknown[]) => string[];
  };

  if (!nodeModule._nodeModulePaths) {
    console.warn(
      "Module._nodeModulePaths not available - module resolution patch skipped. " +
        "Plugins may fail to load if peer dependencies cannot be resolved."
    );
    return;
  }

  const resolvedPath = resolve(extraNodeModulesPath);
  const original = nodeModule._nodeModulePaths;

  nodeModule._nodeModulePaths = (...args: unknown[]) => {
    const paths = original.apply(nodeModule, args);
    if (!paths.includes(resolvedPath)) {
      paths.push(resolvedPath);
    }
    return paths;
  };

  console.log(`✓ Patched module resolution to include: ${resolvedPath}`);
}
