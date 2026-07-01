/**
 * Type Definitions for Dynamic Plugin Loading
 *
 * Shared types used across plugin loading, validation, and reporting.
 */

import type { BackendFeature } from "@backstage/backend-plugin-api";

export type PluginRole = "backend" | "frontend";

export type PluginEntry = {
  name: string;
  version: string;
  dirName: string;
  path: string;
  role: PluginRole;
};

export type PluginManifest = {
  backend: PluginEntry[];
  frontend: PluginEntry[];
};

export type LoadedPlugin = {
  plugin: PluginEntry;
  feature: BackendFeature;
};

export type PluginError = {
  plugin: PluginEntry;
  error: string;
};
