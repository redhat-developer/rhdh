import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings/alpha';

export const userSettingsTranslations = createTranslationResource({
  ref: userSettingsTranslationRef,
  translations: {
    de: () => import('./user-settings-de'),
    en: () => import('./user-settings-en'),
    es: () => import('./user-settings-es'),
    fr: () => import('./user-settings-fr'),
    it: () => import('./user-settings-it'),
    ja: () => import('./ja'),
  },
});
