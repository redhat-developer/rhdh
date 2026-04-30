export type PluginEntry = {
  name: string;
  dirName: string;
  role: string;
  version: string;
  path: string;
};

export type PluginManifest = {
  backend: PluginEntry[];
  frontend: PluginEntry[];
};

export type LoadedPlugin = {
  plugin: PluginEntry;
  feature: unknown;
};

export type PluginError = {
  plugin: PluginEntry;
  error: string;
};
