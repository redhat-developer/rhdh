import {
  TranslationRef,
  TranslationResource,
} from '@backstage/core-plugin-api/alpha';

import { InternalTranslationResource } from '../../types/types';
import { translationResourceGenerator } from './translationResourceGenerator';

export interface TranslationResourceWithRef {
  resource: TranslationResource;
  ref: TranslationRef<string, any>;
}

export interface PluginTranslationConfig {
  scope: string;
  module: string;
  importName: string;
  ref?: string | null;
}

export interface StaticTranslationConfig {
  resource: TranslationResource;
  ref: TranslationRef<string, any>;
}

/**
 * Processes a single plugin translation resource
 */
export function processPluginTranslationResource(
  config: PluginTranslationConfig,
  allPlugins: Record<string, any>,
  overrideTranslations: Record<string, Record<string, Record<string, string>>>,
): TranslationResource | null {
  const { scope, module, importName, ref } = config;
  const plugin = allPlugins[scope]?.[module];
  const resource = plugin?.[importName] as InternalTranslationResource;
  const resourceRef = ref
    ? (plugin?.[ref] as any as TranslationRef<string, any>)
    : null;

  if (!resource?.id) {
    // eslint-disable-next-line no-console
    console.warn(
      `Plugin ${scope} is not configured properly: ${module}.${importName} not found, ignoring translation resource: ${importName}`,
    );
    return null;
  }

  const hasJsonOverrides = overrideTranslations[resource.id];

  if (hasJsonOverrides) {
    if (!resourceRef) {
      // eslint-disable-next-line no-console
      console.warn(
        `Plugin translation ref for ${scope} is not configured, ignoring JSON translation for this plugin`,
      );
      return resource;
    }

    return translationResourceGenerator(
      resourceRef,
      resource,
      overrideTranslations[resource.id],
    );
  }

  return resource;
}

/**
 * Processes a single static translation resource
 */
export function processStaticTranslationResource(
  config: StaticTranslationConfig,
  overrideTranslations: Record<string, Record<string, Record<string, string>>>,
): TranslationResource {
  const { resource, ref } = config;
  const hasJsonOverrides = overrideTranslations[resource?.id];

  if (hasJsonOverrides) {
    return translationResourceGenerator(
      ref,
      resource as any as InternalTranslationResource,
      overrideTranslations[resource.id],
    );
  }

  return resource;
}

/**
 * Processes multiple plugin translation resources
 */
export function processPluginTranslationResources(
  translationResources: PluginTranslationConfig[],
  allPlugins: Record<string, any>,
  overrideTranslations: Record<string, Record<string, Record<string, string>>>,
): {
  resources: TranslationResource[];
  refs: TranslationRef[];
} {
  const resources: TranslationResource[] = [];
  const refs: TranslationRef[] = [];

  translationResources.forEach(config => {
    const resource = processPluginTranslationResource(
      config,
      allPlugins,
      overrideTranslations,
    );

    if (resource) {
      resources.push(resource);

      // Add ref if it exists
      const plugin = allPlugins[config.scope]?.[config.module];
      const resourceRef = config.ref
        ? (plugin?.[config.ref] as any as TranslationRef<string, any>)
        : null;

      if (resourceRef) {
        refs.push(resourceRef);
      }
    }
  });

  return { resources, refs };
}

/**
 * Processes multiple static translation resources
 */
export function processStaticTranslationResources(
  translationResources: StaticTranslationConfig[],
  overrideTranslations: Record<string, Record<string, Record<string, string>>>,
): {
  resources: TranslationResource[];
  refs: TranslationRef[];
} {
  const resources: TranslationResource[] = [];
  const refs: TranslationRef[] = [];

  translationResources.forEach(config => {
    const resource = processStaticTranslationResource(
      config,
      overrideTranslations,
    );
    resources.push(resource);
    refs.push(config.ref);
  });

  return { resources, refs };
}

/**
 * Main function to process all translation resources
 */
export function processAllTranslationResources(
  dynamicTranslationResources: PluginTranslationConfig[],
  staticTranslationResources: StaticTranslationConfig[],
  allPlugins: Record<string, any>,
  overrideTranslations: Record<string, Record<string, Record<string, string>>>,
): {
  allResources: TranslationResource[];
  allRefs: TranslationRef[];
} {
  const dynamicResult = processPluginTranslationResources(
    dynamicTranslationResources,
    allPlugins,
    overrideTranslations,
  );

  const staticResult = processStaticTranslationResources(
    staticTranslationResources,
    overrideTranslations,
  );

  return {
    allResources: [...dynamicResult.resources, ...staticResult.resources],
    allRefs: [...dynamicResult.refs, ...staticResult.refs],
  };
}
