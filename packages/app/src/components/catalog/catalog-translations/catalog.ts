import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { catalogTranslationRef } from '@backstage/plugin-catalog/alpha';

export const catalogTranslations = createTranslationResource({
  ref: catalogTranslationRef,
  translations: {
    en: () => import('./catalog-en'),
  },
});
