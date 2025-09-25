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

import { rhdhTranslationRef } from './ref';

export default createTranslationMessages({
  ref: rhdhTranslationRef,
  full: true, // False means that this is a partial translation
  messages: {
    // Default main menu items from consts.ts
    'menuItem.home': 'Home',
    'menuItem.myGroup': 'Il Mio Gruppo',
    'menuItem.catalog': 'Catalogo',
    'menuItem.apis': 'API',
    'menuItem.learningPaths': 'Percorsi di Apprendimento',
    'menuItem.selfService': 'Self-service',
    'menuItem.administration': 'Amministrazione',
    'menuItem.extensions': 'Estensioni',

    // dynamic-plugins.default.main-menu-items
    'menuItem.clusters': 'Cluster',
    'menuItem.rbac': 'RBAC',
    'menuItem.bulkImport': 'Importazione in massa',
    'menuItem.docs': 'Documentazione',
    'menuItem.lighthouse': 'Lighthouse',
    'menuItem.techRadar': 'Radar tecnologico',
    'menuItem.orchestrator': 'Orchestratore',
    'menuItem.adoptionInsights': 'Insights di adozione',

    'sidebar.menu': 'Menu',
    'sidebar.home': 'Home',
    'sidebar.homeLogo': 'Logo principale',
  },
});
