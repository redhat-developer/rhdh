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
    'menuItem.home': 'Accueil',
    'menuItem.myGroup': 'Mon Groupe',
    'menuItem.catalog': 'Catalogue',
    'menuItem.apis': 'APIs',
    'menuItem.learningPaths': "Parcours d'apprentissage",
    'menuItem.selfService': 'Libre-service',
    'menuItem.administration': 'Administration',
    'menuItem.extensions': 'Modules',

    // dynamic-plugins.default.main-menu-items
    'menuItem.clusters': 'Clusters',
    'menuItem.rbac': 'RBAC',
    'menuItem.bulkImport': 'Importation en masse',
    'menuItem.docs': 'Documentation',
    'menuItem.lighthouse': 'Lighthouse',
    'menuItem.techRadar': 'Radar technologique',
    'menuItem.orchestrator': 'Orchestrateur',
    'menuItem.adoptionInsights': "Insights d'adoption",

    'sidebar.menu': 'Menu',
    'sidebar.home': 'Accueil',
    'sidebar.homeLogo': "Logo d'accueil",
  },
});
