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
  },
});
