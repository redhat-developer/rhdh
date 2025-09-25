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
    'menuItem.home': 'Inicio',
    'menuItem.myGroup': 'Mi Grupo',
    'menuItem.catalog': 'Catálogo',
    'menuItem.apis': 'APIs',
    'menuItem.learningPaths': 'Rutas de Aprendizaje',
    'menuItem.selfService': 'Autoservicio',
    'menuItem.administration': 'Administración',
    'menuItem.extensions': 'Extensiones',

    // dynamic-plugins.default.main-menu-items
    'menuItem.clusters': 'Clústeres',
    'menuItem.rbac': 'RBAC',
    'menuItem.bulkImport': 'Importación masiva',
    'menuItem.docs': 'Documentación',
    'menuItem.lighthouse': 'Lighthouse',
    'menuItem.techRadar': 'Radar tecnológico',
    'menuItem.orchestrator': 'Orquestador',
    'menuItem.adoptionInsights': 'Insights de adopción',

    'sidebar.menu': 'Menú',
    'sidebar.home': 'Inicio',
    'sidebar.homeLogo': 'Logo de inicio',
  },
});
