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

import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';
import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';

/**
 * de translation for core-components.
 * @public
 */
const de = createTranslationMessages({
  ref: coreComponentsTranslationRef,
  full: false,
  messages: {
    'table.filter.placeholder': 'Alle Ergebnisse',
    'table.body.emptyDataSourceMessage': 'Keine Datensätze zum Anzeigen vorhanden',
    'table.pagination.firstTooltip': 'Erste Seite',
    'table.pagination.labelDisplayedRows': '{von}-{bis} von {Anzahl}',
    'table.pagination.labelRowsSelect': 'Zeilen',
    'table.pagination.lastTooltip': 'Letzte Seite',
    'table.pagination.nextTooltip': 'Nächste Seite',
    'table.pagination.previousTooltip': 'Vorherige Seite',
    'table.toolbar.search': 'Filter',
    'alertDisplay.message_one': '({{ count }} neuere Nachricht)',
    'alertDisplay.message_other': '({{ count }} neuere Nachrichten)',
    'table.header.actions': 'Aktionen',
    'oauthRequestDialog.message':
      'Melden Sie sich an, um {{appTitle}} Zugriff auf die APIs und Identitäten von {{provider}} zu erlauben.',
  },
});

export default de;
