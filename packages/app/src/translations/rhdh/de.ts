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
    'menuItem.home': 'Startseite',
    'menuItem.myGroup': 'Meine Gruppe',
    'menuItem.catalog': 'Katalog',
    'menuItem.apis': 'APIs',
    'menuItem.learningPaths': 'Lernpfade',
    'menuItem.selfService': 'Self-Service',
    'menuItem.administration': 'Administration',
    'menuItem.extensions': 'Erweiterungen',

    // dynamic-plugins.default.main-menu-items
    'menuItem.clusters': 'Cluster',
    'menuItem.rbac': 'RBAC',
    'menuItem.bulkImport': 'Massenimport',
    'menuItem.docs': 'Dokumentation',
    'menuItem.lighthouse': 'Lighthouse',
    'menuItem.techRadar': 'Tech-Radar',
    'menuItem.orchestrator': 'Orchestrator',
    'menuItem.adoptionInsights': 'Einführungseinblicke',

    'sidebar.menu': 'Menü',
    'sidebar.home': 'Startseite',
    'sidebar.homeLogo': 'Startseite-Logo',
  },
});
