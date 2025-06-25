import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';

export const scaffolderTranslations = createTranslationResource({
  ref: scaffolderTranslationRef,
  translations: {
    en: () => import('./scaffolder-en'),
  },
});
