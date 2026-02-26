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
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';

/**
 * de translation for scaffolder.
 * @public
 */
const de = createTranslationMessages({
  ref: scaffolderTranslationRef,
  full: false,
  messages: {
    'templateListPage.title': 'Self-Service',
    'templateListPage.pageTitle': 'Self-Service',
    'templateWizardPage.title': 'Self-Service',
    'templateWizardPage.pageTitle': 'Self-Service',
    'templateListPage.contentHeader.registerExistingButtonTitle':
      'Vorhandenes Git-Repository importieren',
  },
});

export default de;
