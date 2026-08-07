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

import { coreComponentsTranslationRef } from '@backstage/core-components';
import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';

const es = createTranslationMessages({
  ref: coreComponentsTranslationRef,
  full: false,
  messages: {
    'table.filter.placeholder': 'Todos los resultados',
    'table.body.emptyDataSourceMessage': 'No hay registros para mostrar',
    'table.pagination.firstTooltip': 'Primera página',
    'table.pagination.labelDisplayedRows': '{from}-{to} de {count}',
    'table.pagination.labelRowsSelect': 'filas',
    'table.pagination.lastTooltip': 'Última página',
    'table.pagination.nextTooltip': 'Página siguiente',
    'table.pagination.previousTooltip': 'Página anterior',
    'table.toolbar.search': 'Filtrar',
    'alertDisplay.message_one': '({{ count }} mensaje nuevo)',
    'alertDisplay.message_other': '({{ count }} mensajes nuevos)',
    'table.header.actions': 'Acciones',
    'oauthRequestDialog.message':
      'Inicie sesión para permitir que {{appTitle}} acceda a las API e identidades de {{provider}}.',
  },
});

export default es;
