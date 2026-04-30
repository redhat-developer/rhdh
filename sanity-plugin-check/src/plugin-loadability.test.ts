import { startTestBackend, mockServices } from "@backstage/backend-test-utils";
import catalogPlugin from "@backstage/plugin-catalog-backend";
import scaffolderPlugin from "@backstage/plugin-scaffolder-backend";

import { patchModuleResolution } from "./setup";
import { loadManifest, loadBackendPlugins, validateFrontendBundle } from "./plugin-loader";
import { KNOWN_FAILURES, buildMergedConfig } from "./config";
import { reportLoadErrors, reportStartupFailure, reportSuccess, reportFrontend, reportSummary } from "./reporter";
import type { PluginError } from "./types";

patchModuleResolution();

const CORE_FEATURES = [catalogPlugin, scaffolderPlugin];

describe("Plugin Loadability Sanity Check", () => {
  const manifest = loadManifest();
  const backendPlugins = manifest.backend.filter((p) => !KNOWN_FAILURES.has(p.dirName));
  const frontendPlugins = manifest.frontend.filter((p) => !KNOWN_FAILURES.has(p.dirName));

  it("Backstage starts with all backend plugins", async () => {
    const { loaded, errors } = loadBackendPlugins(backendPlugins);

    if (errors.length > 0) reportLoadErrors(errors);
    expect(loaded.length).toBeGreaterThan(0);

    const config = buildMergedConfig(loaded);
    const features = [
      ...CORE_FEATURES,
      ...loaded.map((p) => p.feature),
      mockServices.rootConfig.factory({ data: config }),
    ];

    try {
      const backend = await startTestBackend({
        features: features as Parameters<typeof startTestBackend>[0]["features"],
      });
      reportSuccess(loaded);
      await backend.stop();
    } catch (err) {
      reportStartupFailure(err, loaded, config);
      throw err;
    }

    if (errors.length > 0) {
      throw new Error(
        `${errors.length} plugin(s) failed to load:\n` +
          errors.map((e) => `  - ${e.plugin.name}: ${e.error}`).join("\n"),
      );
    }
  }, 60_000);

  it("all frontend plugins have valid bundles", () => {
    const errors: PluginError[] = [];
    const valid: { name: string; version: string }[] = [];

    for (const plugin of frontendPlugins) {
      const error = validateFrontendBundle(plugin);
      if (error) {
        errors.push({ plugin, error });
      } else {
        valid.push({ name: plugin.name, version: plugin.version });
      }
    }

    reportFrontend(frontendPlugins.length, errors, valid);
    expect(errors).toEqual([]);
  });

  it("reports coverage summary", () => {
    reportSummary(manifest);
    const total = manifest.backend.length + manifest.frontend.length;
    expect(total).toBeGreaterThan(0);
  });
});
