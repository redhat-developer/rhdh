import { createFrontendModule } from '@backstage/frontend-plugin-api';
import { TranslationBlueprint } from '@backstage/plugin-app-react';

import { catalogTranslations } from './catalog/catalog';
import { catalogImportTranslations } from './catalog-import/catalog-import';
import { coreComponentsTranslations } from './core-components/core-components';
import { rhdhTranslations } from './rhdh';
import { scaffolderTranslations } from './scaffolder/scaffolder';
import { searchTranslations } from './search/search';
import { userSettingsTranslations } from './user-settings/user-settings';

/**
 * RHDH core translations (`rhdhTranslationRef`, id `rhdh`) plus overrides for
 * the catalog, catalog-import, scaffolder, search, user-settings, and
 * core-components plugin translation resources — ported from
 * `packages/app/src/translations`. Locales: de, es, fr, it, ja.
 */
export const rhdhTranslationsModule = createFrontendModule({
  pluginId: 'app',
  extensions: [
    TranslationBlueprint.make({
      name: 'rhdh',
      params: { resource: rhdhTranslations },
    }),
    TranslationBlueprint.make({
      name: 'catalog',
      params: { resource: catalogTranslations },
    }),
    TranslationBlueprint.make({
      name: 'catalog-import',
      params: { resource: catalogImportTranslations },
    }),
    TranslationBlueprint.make({
      name: 'scaffolder',
      params: { resource: scaffolderTranslations },
    }),
    TranslationBlueprint.make({
      name: 'search',
      params: { resource: searchTranslations },
    }),
    TranslationBlueprint.make({
      name: 'user-settings',
      params: { resource: userSettingsTranslations },
    }),
    TranslationBlueprint.make({
      name: 'core-components',
      params: { resource: coreComponentsTranslations },
    }),
  ],
});
