import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { catalogImportTranslationRef } from '@backstage/plugin-catalog-import/alpha';

const en = createTranslationMessages({
  ref: catalogImportTranslationRef,
  full: false, // False means that this is a partial translation
  messages: {
    'defaultImportPage.headerTitle': 'Import an existing Git repository',
    'importInfoCard.title': 'Import an existing Git repository',
  },
});

export default en;
