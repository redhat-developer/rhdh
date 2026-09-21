import {
  RuntimeSharedDependenciesGlobal,
  BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL,
} from "@backstage/module-federation-common";

const loadAdditionalSharedDependencies = async () => [
  {
    name: "@backstage/core-components",
    version: extract(
      await import("@backstage/core-components/package.json"),
      "version",
    ),
    lib: () => import("@backstage/core-components"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "@backstage/frontend-plugin-api",
    version: extract(
      await import("@backstage/frontend-plugin-api/package.json"),
      "version",
    ),
    lib: () => import("@backstage/frontend-plugin-api"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "@backstage/core-plugin-api",
    version: extract(
      await import("@backstage/core-plugin-api/package.json"),
      "version",
    ),
    lib: () => import("@backstage/core-plugin-api"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "zod",
    version: extract(await import("zod/package.json"), "version"),
    lib: () => import("zod"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")
        .zod,
      eager: false,
    },
  },
  {
    name: "zod/v3",
    version: extract(await import("zod/package.json"), "version"),
    lib: () => import("zod/v3"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")
        .zod,
      eager: false,
    },
  },
  {
    name: "zod/v4",
    version: extract(await import("zod/package.json"), "version"),
    lib: () => import("zod/v4"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")
        .zod,
      eager: false,
    },
  },
  {
    name: "zod/v4/core",
    version: extract(await import("zod/package.json"), "version"),
    lib: () => import("zod/v4/core"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")
        .zod,
      eager: false,
    },
  },
  {
    name: "lodash",
    version: extract(await import("lodash/package.json"), "version"),
    lib: () => import("lodash"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")
        .lodash,
      eager: false,
    },
  },
  {
    name: "@material-ui/core",
    version: extract(await import("@material-ui/core/package.json"), "version"),
    lib: () => import("@material-ui/core"),
    shareConfig: {
      singleton: false,
      requiredVersion: extract(await import("../package.json"), "dependencies")[
        "@material-ui/core"
      ],
      eager: false,
    },
  },
];

export async function addRuntimeSharedDependencies() {
  const { items = [], version } =
    (
      window as {
        [BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL]?: RuntimeSharedDependenciesGlobal;
      }
    )[BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL] ?? {};
  if (version !== "v1") {
    throw new Error(
      `Unsupported version of the runtime shared dependencies: ${version}`,
    );
  }
  const additionalSharedDependencies = await loadAdditionalSharedDependencies();
  items.push(...additionalSharedDependencies);
}

function extract<TObject extends object, K extends keyof TObject>(
  imp: { default?: TObject } | TObject,
  field: K,
): TObject[K] {
  const resolved =
    typeof imp === "object" && imp !== null && "default" in imp && imp.default
      ? imp.default
      : (imp as TObject);
  return resolved[field];
}
