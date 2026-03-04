import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';

export const searchTranslations = createTranslationResource({
  ref: searchTranslationRef,
  translations: {
    de: () => import('./search-de'),
    en: () => import('./search-en'),
    es: () => import('./search-es'),
    fr: () => import('./search-fr'),
    it: () => import('./search-it'),
    ja: () => import('./ja'),
  },
});
