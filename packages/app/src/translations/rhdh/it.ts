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
    'menuItem.userSettings': 'Impostazioni utente',
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

    'catalog.entityPage.overview.title': 'Panoramica',
    'catalog.entityPage.topology.title': 'Topologia',
    'catalog.entityPage.issues.title': 'Problemi',
    'catalog.entityPage.pullRequests.title': 'Pull/Merge Requests',
    'catalog.entityPage.ci.title': 'CI',
    'catalog.entityPage.cd.title': 'CD',
    'catalog.entityPage.kubernetes.title': 'Kubernetes',
    'catalog.entityPage.imageRegistry.title': 'Registro Immagini',
    'catalog.entityPage.monitoring.title': 'Monitoraggio',
    'catalog.entityPage.lighthouse.title': 'Lighthouse',
    'catalog.entityPage.api.title': 'API',
    'catalog.entityPage.dependencies.title': 'Dipendenze',
    'catalog.entityPage.docs.title': 'Documentazione',
    'catalog.entityPage.definition.title': 'Definizione',
    'catalog.entityPage.diagram.title': 'Diagramma del Sistema',
    'catalog.entityPage.workflows.title': 'Flussi di lavoro',

    'sidebar.menu': 'Menu',
    'sidebar.home': 'Home',
    'sidebar.homeLogo': 'Logo principale',

    // SignIn page translations
    'signIn.page.title': 'Seleziona un metodo di accesso',
    'signIn.providers.auth0.title': 'Auth0',
    'signIn.providers.auth0.message': 'Accedi con Auth0',
    'signIn.providers.atlassian.title': 'Atlassian',
    'signIn.providers.atlassian.message': 'Accedi con Atlassian',
    'signIn.providers.microsoft.title': 'Microsoft',
    'signIn.providers.microsoft.message': 'Accedi con Microsoft',
    'signIn.providers.bitbucket.title': 'Bitbucket',
    'signIn.providers.bitbucket.message': 'Accedi con Bitbucket',
    'signIn.providers.bitbucketServer.title': 'Bitbucket Server',
    'signIn.providers.bitbucketServer.message': 'Accedi con Bitbucket Server',
    'signIn.providers.github.title': 'GitHub',
    'signIn.providers.github.message': 'Accedi con GitHub',
    'signIn.providers.gitlab.title': 'GitLab',
    'signIn.providers.gitlab.message': 'Accedi con GitLab',
    'signIn.providers.google.title': 'Google',
    'signIn.providers.google.message': 'Accedi con Google',
    'signIn.providers.oidc.title': 'OIDC',
    'signIn.providers.oidc.message': 'Accedi con OIDC',
    'signIn.providers.okta.title': 'Okta',
    'signIn.providers.okta.message': 'Accedi con Okta',
    'signIn.providers.onelogin.title': 'OneLogin',
    'signIn.providers.onelogin.message': 'Accedi con OneLogin',
    'signIn.providers.saml.title': 'SAML',
    'signIn.providers.saml.message': 'Accedi con SAML',

    // App translations
    'app.scaffolder.title': 'Self-service',
    'app.search.title': 'Cerca',
    'app.search.resultType': 'Tipo di risultato',
    'app.search.softwareCatalog': 'Catalogo software',
    'app.search.filters.kind': 'Tipo',
    'app.search.filters.lifecycle': 'Ciclo di vita',
    'app.search.filters.component': 'Componente',
    'app.search.filters.template': 'Modello',
    'app.search.filters.experimental': 'sperimentale',
    'app.search.filters.production': 'produzione',
    'app.learningPaths.title': 'Percorsi di apprendimento',
    'app.learningPaths.error.title': 'Impossibile recuperare i dati.',
    'app.learningPaths.error.unknownError': 'Errore sconosciuto',
    'app.userSettings.infoCard.title': 'Metadati RHDH',
    'app.userSettings.infoCard.metadataCopied':
      'Metadati copiati negli appunti',
    'app.userSettings.infoCard.copyMetadata': 'Copia metadati negli appunti',
    'app.userSettings.infoCard.showLess': 'Mostra meno',
    'app.userSettings.infoCard.showMore': 'Mostra di più',
    'app.errors.contactSupport': 'Contatta il supporto',
    'app.errors.goBack': 'Indietro',
    'app.errors.notFound.message': 'Non siamo riusciti a trovare quella pagina',
    'app.errors.notFound.additionalInfo':
      'La pagina che stai cercando potrebbe essere stata rimossa, rinominata o è temporaneamente non disponibile.',
    'app.table.createdAt': 'Creato il',
  },
});
