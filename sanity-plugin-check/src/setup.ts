import path from "node:path";
import Module from "node:module";

// Extend Node.js module resolution so extracted OCI plugins
// can find peer deps (e.g. @backstage/backend-plugin-api)
// from this test package's node_modules.
export function patchModuleResolution(): void {
  const nodeModule = Module as unknown as {
    _nodeModulePaths: (...args: unknown[]) => string[];
  };

  if (!nodeModule._nodeModulePaths) return;

  const extraPath = path.resolve(__dirname, "..", "node_modules");
  const original = nodeModule._nodeModulePaths;

  nodeModule._nodeModulePaths = (...args: unknown[]) => {
    const paths = original.apply(nodeModule, args);
    if (!paths.includes(extraPath)) paths.push(extraPath);
    return paths;
  };
}
