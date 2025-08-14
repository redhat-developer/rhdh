import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';

const en = createTranslationMessages({
  ref: scaffolderTranslationRef,
  full: false, // False means that this is a partial translation
  messages: {
    'templateListPage.contentHeader.registerExistingButtonTitle':
      'Import an existing Git repository',
  },
});

export default en;
