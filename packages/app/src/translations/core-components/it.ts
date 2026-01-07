/*
 * Copyright Red Hat, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';

export default createTranslationMessages({
  ref: coreComponentsTranslationRef,
  full: false,
  messages: {
    'table.filter.placeholder': 'Tutti i risultati',
    'table.body.emptyDataSourceMessage': 'Nessun record da visualizzare',
    'table.pagination.firstTooltip': 'Prima pagina',
    'table.pagination.labelDisplayedRows': '{from}-{to} di {count}',
    'table.pagination.labelRowsSelect': 'righe',
    'table.pagination.lastTooltip': 'Ultima pagina',
    'table.pagination.nextTooltip': 'Pagina successiva',
    'table.pagination.previousTooltip': 'Pagina precedente',
    'table.toolbar.search': 'Filtra',
    'alertDisplay.message_one': '({{ count }} messaggio più recente)',
    'alertDisplay.message_other': '({{ count }} messaggi più recenti)',
    'table.header.actions': 'Azioni',
    'oauthRequestDialog.message':
      'Accedere per consentire a {{appTitle}} di accedere alle API e alle identità di {{provider}}.',
  },
});
