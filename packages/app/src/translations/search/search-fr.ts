import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';

const fr = createTranslationMessages({
  ref: searchTranslationRef,
  full: false,
  messages: {
    'sidebarSearchModal.title': 'Rechercher',
  },
});

export default fr;
