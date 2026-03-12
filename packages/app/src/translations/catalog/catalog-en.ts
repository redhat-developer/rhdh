import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { catalogTranslationRef } from '@backstage/plugin-catalog/alpha';

const en = createTranslationMessages({
  ref: catalogTranslationRef,
  full: false, // False means that this is a partial translation
  messages: {
    'indexPage.createButtonTitle': 'Self-service',
  },
});

export default en;
