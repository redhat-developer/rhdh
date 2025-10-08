import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings/alpha';

const de = createTranslationMessages({
  ref: userSettingsTranslationRef,
  full: false,
  messages: {
    sidebarTitle: 'Einstellungen',
  },
});

export default de;
