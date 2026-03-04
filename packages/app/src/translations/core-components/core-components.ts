import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import { createTranslationResource } from '@backstage/core-plugin-api/alpha';

export const coreComponentsTranslations = createTranslationResource({
  ref: coreComponentsTranslationRef,
  translations: {
    de: () => import('./de'),
    en: () => import('./core-components-en'),
    es: () => import('./es'),
    fr: () => import('./fr'),
    it: () => import('./it'),
    ja: () => import('./ja'),
  },
});
