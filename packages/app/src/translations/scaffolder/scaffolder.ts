import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';

export const scaffolderTranslations = createTranslationResource({
  ref: scaffolderTranslationRef,
  translations: {
    de: () => import('./de'),
    en: () => import('./scaffolder-en'),
    es: () => import('./es'),
    fr: () => import('./fr'),
    it: () => import('./it'),
    ja: () => import('./ja'),
  },
});
