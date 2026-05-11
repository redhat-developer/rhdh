import { createTranslationResource } from '@backstage/core-plugin-api/alpha';
import { notificationsTranslationRef } from '@backstage/plugin-notifications';

export const notificationsTranslations = createTranslationResource({
  ref: notificationsTranslationRef,
  translations: {},
});

export { notificationsTranslationRef };
