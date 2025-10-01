import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import {
  createTranslationResource,
  TranslationRef,
  TranslationResource,
} from '@backstage/core-plugin-api/alpha';
import { apiDocsTranslationRef } from '@backstage/plugin-api-docs/alpha';
import { catalogGraphTranslationRef } from '@backstage/plugin-catalog-graph/alpha';
import { catalogImportTranslationRef } from '@backstage/plugin-catalog-import/alpha';
import { catalogReactTranslationRef } from '@backstage/plugin-catalog-react/alpha';
import { catalogTranslationRef } from '@backstage/plugin-catalog/alpha';
import { orgTranslationRef } from '@backstage/plugin-org/alpha';
import { scaffolderReactTranslationRef } from '@backstage/plugin-scaffolder-react/alpha';
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';
import { searchReactTranslationRef } from '@backstage/plugin-search-react/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings/alpha';

import {
  translationsPluginTranslationRef,
  translationsPluginTranslations,
} from '@red-hat-developer-hub/backstage-plugin-translations/alpha';

import { catalogTranslations } from '../../components/catalog/translations/catalog';
import { catalogImportTranslations } from '../../translations/catalog-import/catalog-import';
import { coreComponentsTranslations } from '../../translations/core-components/core-components';
import { rhdhTranslationRef, rhdhTranslations } from '../../translations/rhdh';
import { scaffolderTranslations } from '../../translations/scaffolder/scaffolder';
import { userSettingsTranslations } from '../../translations/user-settings/user-settings';

export interface StaticTranslationConfig {
  resource: TranslationResource;
  ref: TranslationRef<string, any>;
}

/**
 * Static translation configurations for core Backstage components and RHDH translation plugin
 */
export const staticTranslationConfigs: StaticTranslationConfig[] = [
  {
    resource: coreComponentsTranslations,
    ref: coreComponentsTranslationRef,
  },
  {
    resource: userSettingsTranslations,
    ref: userSettingsTranslationRef,
  },
  {
    resource: catalogTranslations,
    ref: catalogTranslationRef,
  },
  {
    resource: scaffolderTranslations,
    ref: scaffolderTranslationRef,
  },
  {
    resource: catalogImportTranslations,
    ref: catalogImportTranslationRef,
  },
  {
    resource: translationsPluginTranslations,
    ref: translationsPluginTranslationRef,
  },

  {
    resource: rhdhTranslations,
    ref: rhdhTranslationRef,
  },
  ...[
    catalogReactTranslationRef,
    scaffolderTranslationRef,
    userSettingsTranslationRef,
    searchTranslationRef,
    searchReactTranslationRef,
    scaffolderReactTranslationRef,
    apiDocsTranslationRef,
    catalogGraphTranslationRef,
    orgTranslationRef,
    userSettingsTranslationRef,
  ].map((ref: TranslationRef<string, any>) => ({
    resource: createTranslationResource({
      ref,
      translations: {},
    }),
    ref,
  })),
];
