import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';

export const searchTranslations = createTranslationResource({
  ref: searchTranslationRef,
  translations: {
    en: () => import('./search-en'),
    de: () => import('./search-de'),
    fr: () => import('./search-fr'),
    es: () => import('./search-es'),
    it: () => import('./search-it'),
  },
});
