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
    'menuItem.userSettings': 'Paramètres utilisateur',
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

    'catalog.entityPage.overview.title': 'Aperçu',
    'catalog.entityPage.topology.title': 'Topologie',
    'catalog.entityPage.issues.title': 'Problèmes',
    'catalog.entityPage.pullRequests.title': 'Pull/Merge Requests',
    'catalog.entityPage.ci.title': 'CI',
    'catalog.entityPage.cd.title': 'CD',
    'catalog.entityPage.kubernetes.title': 'Kubernetes',
    'catalog.entityPage.imageRegistry.title': "Registre d'Images",
    'catalog.entityPage.monitoring.title': 'Surveillance',
    'catalog.entityPage.lighthouse.title': 'Lighthouse',
    'catalog.entityPage.api.title': 'API',
    'catalog.entityPage.dependencies.title': 'Dépendances',
    'catalog.entityPage.docs.title': 'Documentation',
    'catalog.entityPage.definition.title': 'Définition',
    'catalog.entityPage.diagram.title': 'Diagramme du Système',
    'catalog.entityPage.workflows.title': 'Flux de travail',

    'sidebar.menu': 'Menu',
    'sidebar.home': 'Accueil',
    'sidebar.homeLogo': "Logo d'accueil",

    // SignIn page translations
    'signIn.page.title': 'Sélectionner une méthode de connexion',
    'signIn.providers.auth0.title': 'Auth0',
    'signIn.providers.auth0.message': 'Se connecter avec Auth0',
    'signIn.providers.atlassian.title': 'Atlassian',
    'signIn.providers.atlassian.message': 'Se connecter avec Atlassian',
    'signIn.providers.microsoft.title': 'Microsoft',
    'signIn.providers.microsoft.message': 'Se connecter avec Microsoft',
    'signIn.providers.bitbucket.title': 'Bitbucket',
    'signIn.providers.bitbucket.message': 'Se connecter avec Bitbucket',
    'signIn.providers.bitbucketServer.title': 'Bitbucket Server',
    'signIn.providers.bitbucketServer.message':
      'Se connecter avec Bitbucket Server',
    'signIn.providers.github.title': 'GitHub',
    'signIn.providers.github.message': 'Se connecter avec GitHub',
    'signIn.providers.gitlab.title': 'GitLab',
    'signIn.providers.gitlab.message': 'Se connecter avec GitLab',
    'signIn.providers.google.title': 'Google',
    'signIn.providers.google.message': 'Se connecter avec Google',
    'signIn.providers.oidc.title': 'OIDC',
    'signIn.providers.oidc.message': 'Se connecter avec OIDC',
    'signIn.providers.okta.title': 'Okta',
    'signIn.providers.okta.message': 'Se connecter avec Okta',
    'signIn.providers.onelogin.title': 'OneLogin',
    'signIn.providers.onelogin.message': 'Se connecter avec OneLogin',
    'signIn.providers.saml.title': 'SAML',
    'signIn.providers.saml.message': 'Se connecter avec SAML',

    // App translations
    'app.scaffolder.title': 'Libre-service',
    'app.search.title': 'Rechercher',
    'app.search.resultType': 'Type de résultat',
    'app.search.softwareCatalog': 'Catalogue de logiciels',
    'app.search.filters.kind': 'Type',
    'app.search.filters.lifecycle': 'Cycle de vie',
    'app.search.filters.component': 'Composant',
    'app.search.filters.template': 'Modèle',
    'app.search.filters.experimental': 'expérimental',
    'app.search.filters.production': 'production',
    'app.learningPaths.title': "Parcours d'apprentissage",
    'app.learningPaths.error.title': 'Impossible de récupérer les données.',
    'app.learningPaths.error.unknownError': 'Erreur inconnue',
    'app.userSettings.infoCard.title': 'Métadonnées RHDH',
    'app.userSettings.infoCard.metadataCopied':
      'Métadonnées copiées dans le presse-papiers',
    'app.userSettings.infoCard.copyMetadata':
      'Copier les métadonnées dans le presse-papiers',
    'app.userSettings.infoCard.showLess': 'Afficher moins',
    'app.userSettings.infoCard.showMore': 'Afficher plus',
    'app.errors.contactSupport': 'Contacter le support',
    'app.errors.goBack': 'Retour',
    'app.errors.notFound.message': "Nous n'avons pas pu trouver cette page",
    'app.errors.notFound.additionalInfo':
      'La page que vous recherchez a peut-être été supprimée, renommée ou est temporairement indisponible.',
    'app.table.createdAt': 'Créé le',
  },
});
