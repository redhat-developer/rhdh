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
  const resolvedPath = resolve(extraNodeModulesPath);

  const nodeModule = Module as unknown as {
    _nodeModulePaths: (...args: unknown[]) => string[];
    _initPaths?: () => void;
  };

  if (!nodeModule._nodeModulePaths) {
    console.warn(
      "Module._nodeModulePaths not available - falling back to NODE_PATH. " +
        "Plugins may fail to load if peer dependencies cannot be resolved.",
    );

    // Fallback: use NODE_PATH environment variable
    const currentNodePath = process.env.NODE_PATH || "";
    const paths = currentNodePath
      .split(process.platform === "win32" ? ";" : ":")
      .filter(Boolean);

    if (!paths.includes(resolvedPath)) {
      paths.push(resolvedPath);
      process.env.NODE_PATH = paths.join(
        process.platform === "win32" ? ";" : ":",
      );

      // Reinitialize module paths if available
      if (nodeModule._initPaths) {
        nodeModule._initPaths();
      }

      console.log(`✓ Added to NODE_PATH: ${resolvedPath}`);
    }
    return;
  }

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
