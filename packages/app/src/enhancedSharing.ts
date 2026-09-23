import {
  RuntimeSharedDependenciesGlobal,
  BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL,
} from "@backstage/module-federation-common";

import { version as coreComponentsVersion } from "@backstage/core-components/package.json";
import { version as frontendPluginApiVersion } from "@backstage/frontend-plugin-api/package.json";
import { version as corePluginApiVersion } from "@backstage/core-plugin-api/package.json";
import { version as zodVersion } from "zod/package.json";
import { version as lodashVersion } from "lodash/package.json";
import { version as materialUiCoreVersion } from "@material-ui/core/package.json";
import { dependencies as appDependencies } from "../package.json";

const additionalSharedDependencies = [
  {
    name: "@backstage/core-components",
    version: coreComponentsVersion,
    lib: () => import("@backstage/core-components"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "@backstage/frontend-plugin-api",
    version: frontendPluginApiVersion,
    lib: () => import("@backstage/frontend-plugin-api"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "@backstage/core-plugin-api",
    version: corePluginApiVersion,
    lib: () => import("@backstage/core-plugin-api"),
    shareConfig: {
      singleton: false,
      requiredVersion: "*",
      eager: true,
    },
  },
  {
    name: "zod",
    version: zodVersion,
    lib: () => import("zod"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies.zod,
      eager: false,
    },
  },
  {
    name: "zod/v3",
    version: zodVersion,
    lib: () => import("zod/v3"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies.zod,
      eager: false,
    },
  },
  {
    name: "zod/v4",
    version: zodVersion,
    lib: () => import("zod/v4"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies.zod,
      eager: false,
    },
  },
  {
    name: "zod/v4/core",
    version: zodVersion,
    lib: () => import("zod/v4/core"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies.zod,
      eager: false,
    },
  },
  {
    name: "lodash",
    version: lodashVersion,
    lib: () => import("lodash"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies.lodash,
      eager: false,
    },
  },
  {
    name: "@material-ui/core",
    version: materialUiCoreVersion,
    lib: () => import("@material-ui/core"),
    shareConfig: {
      singleton: false,
      requiredVersion: appDependencies["@material-ui/core"],
      eager: false,
    },
  },
];

export function addRuntimeSharedDependencies() {
  const sharedDependencies = (
    window as {
      [BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL]?: RuntimeSharedDependenciesGlobal;
    }
  )[BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL];

  // Hosts without shared runtime dependencies cannot be enhanced.
  if (!sharedDependencies) {
    return;
  }

  if (sharedDependencies.version !== "v1") {
    throw new Error(
      `Unsupported version of the runtime shared dependencies: ${sharedDependencies.version}`,
    );
  }

  sharedDependencies.items.push(...additionalSharedDependencies);
}
