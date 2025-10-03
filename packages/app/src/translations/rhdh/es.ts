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
    'menuItem.userSettings': 'Configuración de usuario',
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

    'catalog.entityPage.overview.title': 'Resumen',
    'catalog.entityPage.topology.title': 'Topología',
    'catalog.entityPage.issues.title': 'Problemas',
    'catalog.entityPage.pullRequests.title': 'Pull/Merge Requests',
    'catalog.entityPage.ci.title': 'CI',
    'catalog.entityPage.cd.title': 'CD',
    'catalog.entityPage.kubernetes.title': 'Kubernetes',
    'catalog.entityPage.imageRegistry.title': 'Registro de Imágenes',
    'catalog.entityPage.monitoring.title': 'Monitoreo',
    'catalog.entityPage.lighthouse.title': 'Lighthouse',
    'catalog.entityPage.api.title': 'API',
    'catalog.entityPage.dependencies.title': 'Dependencias',
    'catalog.entityPage.docs.title': 'Documentación',
    'catalog.entityPage.definition.title': 'Definición',
    'catalog.entityPage.diagram.title': 'Diagrama del Sistema',
    'catalog.entityPage.workflows.title': 'Flujos de trabajo',

    'sidebar.menu': 'Menú',
    'sidebar.home': 'Inicio',
    'sidebar.homeLogo': 'Logo de inicio',

    // SignIn page translations
    'signIn.page.title': 'Seleccionar un método de inicio de sesión',
    'signIn.providers.auth0.title': 'Auth0',
    'signIn.providers.auth0.message': 'Iniciar sesión con Auth0',
    'signIn.providers.atlassian.title': 'Atlassian',
    'signIn.providers.atlassian.message': 'Iniciar sesión con Atlassian',
    'signIn.providers.microsoft.title': 'Microsoft',
    'signIn.providers.microsoft.message': 'Iniciar sesión con Microsoft',
    'signIn.providers.bitbucket.title': 'Bitbucket',
    'signIn.providers.bitbucket.message': 'Iniciar sesión con Bitbucket',
    'signIn.providers.bitbucketServer.title': 'Bitbucket Server',
    'signIn.providers.bitbucketServer.message':
      'Iniciar sesión con Bitbucket Server',
    'signIn.providers.github.title': 'GitHub',
    'signIn.providers.github.message': 'Iniciar sesión con GitHub',
    'signIn.providers.gitlab.title': 'GitLab',
    'signIn.providers.gitlab.message': 'Iniciar sesión con GitLab',
    'signIn.providers.google.title': 'Google',
    'signIn.providers.google.message': 'Iniciar sesión con Google',
    'signIn.providers.oidc.title': 'OIDC',
    'signIn.providers.oidc.message': 'Iniciar sesión con OIDC',
    'signIn.providers.okta.title': 'Okta',
    'signIn.providers.okta.message': 'Iniciar sesión con Okta',
    'signIn.providers.onelogin.title': 'OneLogin',
    'signIn.providers.onelogin.message': 'Iniciar sesión con OneLogin',
    'signIn.providers.saml.title': 'SAML',
    'signIn.providers.saml.message': 'Iniciar sesión con SAML',

    // App translations
    'app.scaffolder.title': 'Autoservicio',
    'app.search.title': 'Buscar',
    'app.search.resultType': 'Tipo de resultado',
    'app.search.softwareCatalog': 'Catálogo de software',
    'app.search.filters.kind': 'Tipo',
    'app.search.filters.lifecycle': 'Ciclo de vida',
    'app.search.filters.component': 'Componente',
    'app.search.filters.template': 'Plantilla',
    'app.search.filters.experimental': 'experimental',
    'app.search.filters.production': 'producción',
    'app.learningPaths.title': 'Rutas de aprendizaje',
    'app.learningPaths.error.title': 'No se pudieron obtener los datos.',
    'app.learningPaths.error.unknownError': 'Error desconocido',
    'app.userSettings.infoCard.title': 'Metadatos RHDH',
    'app.userSettings.infoCard.metadataCopied':
      'Metadatos copiados al portapapeles',
    'app.userSettings.infoCard.copyMetadata':
      'Copiar metadatos al portapapeles',
    'app.userSettings.infoCard.showLess': 'Mostrar menos',
    'app.userSettings.infoCard.showMore': 'Mostrar más',
    'app.errors.contactSupport': 'Contactar soporte',
    'app.errors.goBack': 'Volver',
    'app.errors.notFound.message': 'No pudimos encontrar esa página',
    'app.errors.notFound.additionalInfo':
      'La página que buscas pudo haber sido eliminada, renombrada o está temporalmente no disponible.',
    'app.table.createdAt': 'Creado el',
  },
});
