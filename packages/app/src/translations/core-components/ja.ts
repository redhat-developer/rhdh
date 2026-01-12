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
    'table.filter.placeholder': 'すべての結果',
    'table.body.emptyDataSourceMessage': '表示するレコードがありません',
    'table.pagination.firstTooltip': '最初のページ',
    'table.pagination.labelDisplayedRows': '{count} 件中 {from}-{to} 件目',
    'table.pagination.labelRowsSelect': '行',
    'table.pagination.lastTooltip': '最後のページ',
    'table.pagination.nextTooltip': '次のページ',
    'table.pagination.previousTooltip': '前のページ',
    'table.toolbar.search': 'フィルター',
    'alertDisplay.message_one': '({{ count }} 件の新しいメッセージ)',
    'alertDisplay.message_other': '({{ count }} 件の新しいメッセージ)',
    'table.header.actions': 'アクション',
    'oauthRequestDialog.message':
      '{{appTitle}} が {{provider}} API と ID にアクセスすることを許可するには、サインインしてください。',
  },
});
