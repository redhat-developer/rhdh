import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { searchTranslationRef } from '@backstage/plugin-search/alpha';

const es = createTranslationMessages({
  ref: searchTranslationRef,
  full: false,
  messages: {
    'sidebarSearchModal.title': 'Buscar',
  },
});

export default es;
