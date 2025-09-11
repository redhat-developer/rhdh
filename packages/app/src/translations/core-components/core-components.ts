import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import { createTranslationResource } from '@backstage/core-plugin-api/alpha';

export const coreComponentsTranslations = createTranslationResource({
  ref: coreComponentsTranslationRef,
  translations: {
    en: () => import('./core-components-en'),
  },
});
