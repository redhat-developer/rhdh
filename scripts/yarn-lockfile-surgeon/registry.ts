import packageJson from "package-json";
import type { AbbreviatedVersion, AbbreviatedMetadata } from "package-json";
import type { RegistryFetcher } from "./lib.ts";

/** Creates a new registry fetcher with its own cache. */
export function createNpmFetcher(): RegistryFetcher {
  const cache = new Map<string, AbbreviatedMetadata>();

  return {
    /**
     * Fetches all published versions of a package from the npm registry.
     * Results are cached per package name to avoid redundant requests when the
     * same package appears as a transitive dependency of multiple targets.
     */
    async fetchAllVersions(
      name: string,
    ): Promise<Record<string, AbbreviatedVersion>> {
      if (cache.has(name)) return cache.get(name)!.versions;

      const data = await packageJson(name, {
        allVersions: true,
        omitDeprecated: false,
      });
      cache.set(name, data);
      return data.versions;
    },

    /** Fetches abbreviated metadata for a single package version. */
    async fetchVersion(
      name: string,
      version: string,
    ): Promise<AbbreviatedVersion> {
      return packageJson(name, { version });
    },
  };
}
