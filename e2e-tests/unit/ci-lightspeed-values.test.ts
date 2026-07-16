import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { isRecord } from "../playwright/utils/kube-client/helpers";

/**
 * Seam: CI helm value files must disable lightspeed inherit packages so
 * install-dynamic-plugins cannot InstallException (#4791 / #4869 regression).
 * Post-#5021 the field is `enabled: false` (not legacy `disabled: true`).
 */
const valueFilesDir = join(import.meta.dirname, "../../.ci/pipelines/value_files");

/** Exact package prefixes the installer matches after helm renders inherit. */
const lightspeedPackages = [
  "oci://registry.access.redhat.com/rhdh/red-hat-developer-hub-backstage-plugin-lightspeed:{{",
  "oci://registry.access.redhat.com/rhdh/red-hat-developer-hub-backstage-plugin-lightspeed-backend:{{",
] as const;

function pluginsFromValuesFile(fileName: string): Array<Record<string, unknown>> {
  const doc: unknown = parseYaml(readFileSync(join(valueFilesDir, fileName), "utf8"));
  if (!isRecord(doc) || !isRecord(doc.global) || !isRecord(doc.global.dynamic)) {
    throw new TypeError(`${fileName}: missing global.dynamic`);
  }
  const plugins = doc.global.dynamic.plugins;
  if (!Array.isArray(plugins)) {
    throw new TypeError(`${fileName}: global.dynamic.plugins is not an array`);
  }
  return plugins.filter((plugin): plugin is Record<string, unknown> => isRecord(plugin));
}

describe("CI helm value lightspeed overrides", () => {
  it.each(["values_showcase.yaml", "values_showcase-rbac.yaml"] as const)(
    "sets enabled: false on lightspeed inherit packages in %s",
    (fileName) => {
      const plugins = pluginsFromValuesFile(fileName);
      for (const prefix of lightspeedPackages) {
        const match = plugins.find(
          (plugin) => typeof plugin.package === "string" && plugin.package.startsWith(prefix),
        );
        expect(match, `${fileName} missing override for ${prefix}`).toBeDefined();
        expect(match?.enabled, `${fileName} ${prefix} must set enabled: false`).toBe(false);
        expect(match?.disabled, `${fileName} must not use legacy disabled`).toBeUndefined();
        // Helm-escaped inherit tag in source values (renders to :{{inherit}}).
        expect(String(match?.package)).toMatch(/inherit/u);
      }
    },
  );
});
