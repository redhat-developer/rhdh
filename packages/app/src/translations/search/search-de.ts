import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';

const de = createTranslationMessages({
  ref: searchTranslationRef,
  full: false,
  messages: {
    'sidebarSearchModal.title': 'Suchen',
  },
});

export default de;
