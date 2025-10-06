import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings/alpha';

const es = createTranslationMessages({
  ref: userSettingsTranslationRef,
  full: false,
  messages: {
    sidebarTitle: 'Configuración',
  },
});

export default es;
