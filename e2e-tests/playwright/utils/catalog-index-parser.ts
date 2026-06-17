/**
 * Catalog Index Parser
 *
 * Fetches and parses the RHDH plugin catalog index to extract plugin metadata.
 * The catalog index is an OCI image manifest listing all available dynamic plugins.
 *
 * Example catalog index structure:
 * {
 *   "plugins": [
 *     {
 *       "name": "backstage-plugin-catalog",
 *       "version": "1.0.0",
 *       "ociUrl": "oci://quay.io/rhdh/plugin-catalog:1.0.0",
 *       "role": "backend-plugin",
 *       "supportLevel": "generally-available"
 *     }
 *   ]
 * }
 */

import { execSync } from "child_process";
import * as yaml from "yaml";

export interface PluginMetadata {
  name: string;
  version: string;
  ociUrl: string;
  role: "backend-plugin" | "frontend-plugin" | "backend-plugin-module";
  supportLevel?: "generally-available" | "tech-preview" | "community" | "dev-preview";
}

export interface CatalogIndex {
  plugins: PluginMetadata[];
}

/**
 * Fetches the catalog index from a container registry using skopeo.
 *
 * @param catalogIndexUrl - OCI URL of the catalog index (e.g., "oci://quay.io/rhdh/plugin-catalog-index:latest")
 * @returns Parsed catalog index with plugin metadata
 */
export async function fetchCatalogIndex(
  catalogIndexUrl: string
): Promise<CatalogIndex> {
  try {
    // Use skopeo to inspect the OCI image manifest
    const inspectCmd = `skopeo inspect --no-tags docker://${catalogIndexUrl.replace("oci://", "")}`;
    const manifestJson = execSync(inspectCmd, { encoding: "utf8" });
    const manifest = JSON.parse(manifestJson);

    // The catalog index stores plugin metadata in OCI image labels
    const labels = manifest.Labels || {};

    // Parse the plugin list from the manifest
    // (Catalog index format may vary - adjust based on actual structure)
    const pluginsYaml = labels["io.rhdh.plugins"] || labels["plugins"];

    if (!pluginsYaml) {
      console.warn("No plugin metadata found in catalog index labels");
      return { plugins: [] };
    }

    const catalogData = yaml.parse(pluginsYaml);
    return catalogData as CatalogIndex;
  } catch (error) {
    console.error("Failed to fetch catalog index:", error);
    throw new Error(`Catalog index fetch failed: ${error}`);
  }
}

/**
 * Alternative: Fetch catalog index from a direct YAML URL.
 * Useful if the catalog index is published as a YAML file rather than OCI manifest.
 *
 * @param catalogYamlUrl - HTTP(S) URL to the catalog YAML file
 * @returns Parsed catalog index
 */
export async function fetchCatalogIndexFromYaml(
  catalogYamlUrl: string
): Promise<CatalogIndex> {
  try {
    const response = await fetch(catalogYamlUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const yamlText = await response.text();
    const catalogData = yaml.parse(yamlText);
    return catalogData as CatalogIndex;
  } catch (error) {
    console.error("Failed to fetch catalog YAML:", error);
    throw new Error(`Catalog YAML fetch failed: ${error}`);
  }
}

/**
 * Filters plugins by role (backend vs frontend).
 *
 * @param catalogIndex - Full catalog index
 * @param role - Plugin role to filter by
 * @returns Filtered list of plugins
 */
export function filterPluginsByRole(
  catalogIndex: CatalogIndex,
  role: PluginMetadata["role"]
): PluginMetadata[] {
  return catalogIndex.plugins.filter((p) => p.role === role);
}

/**
 * Filters plugins by support level.
 *
 * @param catalogIndex - Full catalog index
 * @param supportLevel - Support level to filter by
 * @returns Filtered list of plugins
 */
export function filterPluginsBySupportLevel(
  catalogIndex: CatalogIndex,
  supportLevel: PluginMetadata["supportLevel"]
): PluginMetadata[] {
  return catalogIndex.plugins.filter((p) => p.supportLevel === supportLevel);
}

/**
 * For local testing: Parse catalog index from a local file.
 *
 * @param filePath - Path to local catalog YAML file
 * @returns Parsed catalog index
 */
export async function parseCatalogIndexFromFile(
  filePath: string
): Promise<CatalogIndex> {
  const fs = await import("fs/promises");
  const yamlText = await fs.readFile(filePath, "utf8");
  const catalogData = yaml.parse(yamlText);
  return catalogData as CatalogIndex;
}
