import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { catalogTranslationRef } from '@backstage/plugin-catalog';

export const catalogTranslations = createTranslationResource({
  ref: catalogTranslationRef,
  translations: {
    de: () => import('./de'),
    en: () => import('./catalog-en'),
    es: () => import('./es'),
    fr: () => import('./fr'),
    it: () => import('./it'),
    ja: () => import('./ja'),
  },
});
