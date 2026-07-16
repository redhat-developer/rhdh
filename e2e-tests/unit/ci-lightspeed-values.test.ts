import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { isRecord } from "../playwright/utils/kube-client/helpers";

/**
 * Seam: CI helm value files must disable lightspeed {{inherit}} packages so
 * install-dynamic-plugins cannot InstallException (#4791 / #4869 regression).
 */
const valueFilesDir = join(import.meta.dirname, "../../.ci/pipelines/value_files");

const lightspeedPackages = [
  "oci://registry.access.redhat.com/rhdh/red-hat-developer-hub-backstage-plugin-lightspeed",
  "oci://registry.access.redhat.com/rhdh/red-hat-developer-hub-backstage-plugin-lightspeed-backend",
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
    "disables lightspeed inherit packages in %s",
    (fileName) => {
      const plugins = pluginsFromValuesFile(fileName);
      for (const prefix of lightspeedPackages) {
        const match = plugins.find(
          (plugin) => typeof plugin.package === "string" && plugin.package.startsWith(prefix),
        );
        expect(match, `${fileName} missing disabled override for ${prefix}`).toBeDefined();
        expect(match?.disabled, `${fileName} ${prefix} must set disabled: true`).toBe(true);
        // Values files helm-escape as {{ "{{" }}inherit{{ "}}" }} so the
        // rendered package still carries an inherit tag.
        expect(String(match?.package)).toContain("inherit");
      }
    },
  );
});
