import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings';

const en = createTranslationMessages({
  ref: userSettingsTranslationRef,
  full: false,
  messages: {
    sidebarTitle: 'Settings',
  },
});

export default en;
