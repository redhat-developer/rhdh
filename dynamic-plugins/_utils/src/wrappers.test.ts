import { glob } from "glob";
import fs from "node:fs";
import path from "node:path";
import yaml from "yaml";

const PACKAGE_JSON_GLOB = "**/package.json";
const IGNORE_GLOB = ["**/node_modules/**", "**/dist-dynamic/**"];

const ROOT_DIR = path.join(__dirname, "../../..");
const DYNAMIC_PLUGINS_DIR = path.join(ROOT_DIR, "dynamic-plugins/wrappers");
const DYNAMIC_PLUGINS_CONFIG_FILE = path.join(
  ROOT_DIR,
  "dynamic-plugins.default.yaml",
);
const APP_CONFIG_DYNAMIC_PLUGINS_CONFIG_FILE = path.join(
  ROOT_DIR,
  "app-config.dynamic-plugins.yaml",
);
const IBM_VALUES_SHOWCASE_CONFIG_FILE = path.join(
  ROOT_DIR,
  ".ibm/pipelines/value_files/values_showcase.yaml",
);
const IBM_VALUES_SHOWCASE_RBAC_CONFIG_FILE = path.join(
  ROOT_DIR,
  ".ibm/pipelines/value_files/values_showcase-rbac.yaml",
);
const IBM_VALUES_SHOWCASE_AUTH_PROVIDERS_CONFIG_FILE = path.join(
  ROOT_DIR,
  ".ibm/pipelines/value_files/values_showcase-auth-providers.yaml",
);
const RHDH_OPENSHIFT_SETUP_CONFIG_FILE = path.join(
  ROOT_DIR,
  "scripts/rhdh-openshift-setup/values.yaml",
);

type WrapperFrontendPackageJson = {
  name: string;
  backstage: {
    role: "frontend-plugin";
  };
  scalprum: {
    name: string;
  };
  repository: {
    directory: string;
  };
};

type WrapperBackendPackageJson = {
  name: string;
  backstage: {
    role: "backend-plugin" | "backend-plugin-module";
  };
  repository: {
    directory: string;
  };
};

type WrapperPackageJson =
  | WrapperFrontendPackageJson
  | WrapperBackendPackageJson;

type DynamicPluginAppConfig = {
  dynamicPlugins?: { frontend?: Record<string, unknown> };
};

type DynamicPluginConfig = {
  package: string;
  disabled?: boolean;
  pluginConfig?: DynamicPluginAppConfig;
};

type DynamicPluginsConfig = {
  plugins: DynamicPluginConfig[];
};

type GlobalDynamicPluginsConfig = {
  global: {
    dynamic: {
      plugins: {
        package: string;
        disabled?: boolean;
        pluginConfig?: DynamicPluginAppConfig;
      }[];
    };
  };
};

function isFrontendPlugin(
  packageJson: WrapperPackageJson,
): packageJson is WrapperFrontendPackageJson {
  return packageJson.backstage.role === "frontend-plugin";
}

function isBackendPlugin(
  packageJson: WrapperPackageJson,
): packageJson is WrapperBackendPackageJson {
  return (
    packageJson.backstage.role === "backend-plugin" ||
    packageJson.backstage.role === "backend-plugin-module"
  );
}

function getDifference<T>(arrA: T[], arrB: T[]): T[] {
  return arrA.filter((x) => !arrB.includes(x));
}

function parseYamlFile<T>(filePath: string): T {
  return yaml.parse(fs.readFileSync(filePath).toString());
}

function validateDynamicPluginsConfig(
  config: DynamicPluginsConfig,
  wrapperDirNames: string[],
  externalDynamicPlugins?: DynamicPluginConfig[],
): void {
  const dynamicPluginsPackageNames = config.plugins.reduce(
    (packageNames, plugin) => {
      const isExternalPlugin = externalDynamicPlugins?.some(
        (externalDynamicPlugin) =>
          externalDynamicPlugin.package === plugin.package,
      ) || !plugin.package.startsWith("./");
      if (!isExternalPlugin) {
        // We want the third index ['.', 'dynamic-plugins', 'dist', 'backstage-plugin-scaffolder-backend-module-github-dynamic']
        packageNames.push(plugin.package.split("/")[3]);
      }

      return packageNames;
    },
    [] as string[],
  );

  const difference = getDifference(dynamicPluginsPackageNames, wrapperDirNames);

  try {
    expect(difference).toStrictEqual([]);
  } catch {
    throw new Error(
      `The following plugins are missing: ${difference.join(", ")}`,
    );
  }
}

describe("Dynamic Plugin Wrappers", () => {
  const wrapperPackageJsonPaths = glob.sync(PACKAGE_JSON_GLOB, {
    cwd: DYNAMIC_PLUGINS_DIR, // Search only within DYNAMIC_PLUGINS_DIR
    ignore: IGNORE_GLOB,
  });

  const wrapperDirNames = wrapperPackageJsonPaths.map(path.dirname);

  const wrapperPackageJsonFiles = wrapperPackageJsonPaths.map(
    (packageJsonPath) => {
      const packageJson = fs.readFileSync(
        path.join(DYNAMIC_PLUGINS_DIR, packageJsonPath),
      );
      return JSON.parse(packageJson.toString()) as WrapperPackageJson;
    },
  );
  const frontendPackageJsonFiles = wrapperPackageJsonFiles.filter(
    (packageJson) => isFrontendPlugin(packageJson),
  );
  const backendPackageJsonFiles = wrapperPackageJsonFiles.filter(
    (packageJson) => isBackendPlugin(packageJson),
  );

  describe("Backend Plugin", () => {
    it.each(backendPackageJsonFiles)(
      "$name should have a `-dynamic` suffix in the directory name",
      ({ name, repository }) => {
        const hasDynamicSuffix = wrapperPackageJsonPaths.some((value) =>
          value.includes(`${name}-dynamic`),
        );
        expect(hasDynamicSuffix).toBeTruthy();
        expect(repository.directory).toBe(
          `dynamic-plugins/wrappers/${name}-dynamic`,
        );
      },
    );
  });

  describe("Frontend Plugin", () => {
    it.each(frontendPackageJsonFiles)(
      "$name should have a matching directory name",
      ({ name, repository }) => {
        const hasMatchingDirName = wrapperPackageJsonPaths.some((value) =>
          value.includes(name),
        );
        expect(hasMatchingDirName).toBeTruthy();
        expect(repository.directory).toBe(`dynamic-plugins/wrappers/${name}`);
      },
    );

    it.each(frontendPackageJsonFiles)(
      "should have scalprum config in the `package.json`",
      ({ scalprum }) => {
        expect(scalprum).toBeTruthy();
      },
    );
  });

  describe("(dynamic-plugins.default.yaml) should have a valid config", () => {
    const config = parseYamlFile<DynamicPluginsConfig>(
      DYNAMIC_PLUGINS_CONFIG_FILE,
    );

    it("should have a corresponding package", () => {
      validateDynamicPluginsConfig(config, wrapperDirNames);
    });

    it.each(frontendPackageJsonFiles)(
      "$scalprum.name should exist in the config",
      ({ scalprum }) => {
        expect(
          config.plugins.some((plugin) =>
            Object.keys(
              plugin.pluginConfig?.dynamicPlugins?.frontend ?? {},
            ).includes(scalprum.name),
          ),
        ).toBeTruthy();
      },
    );
  });

  describe("(app-config.dynamic-plugins.yaml) should have a valid config", () => {
    const config = parseYamlFile<DynamicPluginAppConfig>(
      APP_CONFIG_DYNAMIC_PLUGINS_CONFIG_FILE,
    );

    it.each(frontendPackageJsonFiles)(
      "$scalprum.name should exist in the config",
      ({ scalprum }) => {
        expect(
          Object.keys(config?.dynamicPlugins?.frontend ?? {}).includes(
            scalprum.name,
          ),
        ).toBeTruthy();
      },
    );
  });

  describe("(ibm: values_showcase.yaml) should have a valid config", () => {
    const config = parseYamlFile<GlobalDynamicPluginsConfig>(
      IBM_VALUES_SHOWCASE_CONFIG_FILE,
    );

    const externalDynamicPluginsConfig: DynamicPluginConfig[] = [
      {
        package: "@pataknight/backstage-plugin-rhdh-qe-theme@0.5.5",
        disabled: false,
      },
      {
        package: "@backstage-community/plugin-todo@0.2.42",
      },
      {
        package:
          "@red-hat-developer-hub/backstage-plugin-application-provider-test@0.0.2",
      },
      {
        package:
          "@red-hat-developer-hub/backstage-plugin-application-listener-test@0.0.2",
      },
      {
        package:
          "@red-hat-developer-hub/backstage-plugin-global-header-test@0.0.2",
      },
      {
        package:
          "oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-middleware-header-example-dynamic",
      },
      {
        package:
          "oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat",
      },
      {
        package:
          "oci://quay.io/gashcrumb/example-root-http-middleware:latest!internal-backstage-plugin-simple-chat-backend-dynamic",
      },
    ];

    it("should have a corresponding package", () => {
      validateDynamicPluginsConfig(
        config.global.dynamic,
        wrapperDirNames,
        externalDynamicPluginsConfig,
      );
    });
  });

  describe("(ibm: values_showcase-rbac.yaml) should have a valid config", () => {
    const config = parseYamlFile<GlobalDynamicPluginsConfig>(
      IBM_VALUES_SHOWCASE_RBAC_CONFIG_FILE,
    );

    it("should have a corresponding package", () => {
      validateDynamicPluginsConfig(config.global.dynamic, wrapperDirNames);
    });
  });

  describe("(ibm: values_showcase_auth-providers.yaml) should have a valid config", () => {
    const config = parseYamlFile<GlobalDynamicPluginsConfig>(
      IBM_VALUES_SHOWCASE_AUTH_PROVIDERS_CONFIG_FILE,
    );

    it("should have a corresponding package", () => {
      validateDynamicPluginsConfig(config.global.dynamic, wrapperDirNames);
    });
  });

  describe("(rhdh-openshift-setup: values.yaml) should have a valid config", () => {
    const config = parseYamlFile<GlobalDynamicPluginsConfig>(
      RHDH_OPENSHIFT_SETUP_CONFIG_FILE,
    );

    it("should have a corresponding package", () => {
      validateDynamicPluginsConfig(config.global.dynamic, wrapperDirNames);
    });
  });
});
