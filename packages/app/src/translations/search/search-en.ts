import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search';

const en = createTranslationMessages({
  ref: searchTranslationRef,
  full: false,
  messages: {
    'sidebarSearchModal.title': 'Search',
  },
});

export default en;
