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

import { createTranslationRef } from '@backstage/core-plugin-api/alpha';

/**
 * Messages object containing all English translations.
 * This is our single source of truth for translations.
 */
export const rhdhMessages = {
  menuItem: {
    // Default main menu items from consts.ts
    home: 'Home',
    myGroup: 'My Group',
    catalog: 'Catalog',
    apis: 'APIs',
    learningPaths: 'Learning Paths',
    selfService: 'Self-service',
    administration: 'Administration',
    extensions: 'Extensions',

    // dynamic-plugins.default.main-menu-items
    clusters: 'Clusters',
    rbac: 'RBAC',
    bulkImport: 'Bulk import',
    docs: 'Docs',
    lighthouse: 'Lighthouse',
    techRadar: 'Tech Radar',
    orchestrator: 'Orchestrator',
    adoptionInsights: 'Adoption Insights',
  },
  sidebar: {
    menu: 'Menu',
    home: 'Home',
    homeLogo: 'Home logo',
  },
  signIn: {
    page: {
      title: 'Select a sign-in method',
    },
    providers: {
      auth0: {
        title: 'Auth0',
        message: 'Sign in using Auth0',
      },
      atlassian: {
        title: 'Atlassian',
        message: 'Sign in using Atlassian',
      },
      microsoft: {
        title: 'Microsoft',
        message: 'Sign in using Microsoft',
      },
      bitbucket: {
        title: 'Bitbucket',
        message: 'Sign in using Bitbucket',
      },
      bitbucketServer: {
        title: 'Bitbucket Server',
        message: 'Sign in using Bitbucket Server',
      },
      github: {
        title: 'GitHub',
        message: 'Sign in using GitHub',
      },
      gitlab: {
        title: 'GitLab',
        message: 'Sign in using GitLab',
      },
      google: {
        title: 'Google',
        message: 'Sign in using Google',
      },
      oidc: {
        title: 'OIDC',
        message: 'Sign in using OIDC',
      },
      okta: {
        title: 'Okta',
        message: 'Sign in using Okta',
      },
      onelogin: {
        title: 'OneLogin',
        message: 'Sign in using OneLogin',
      },
      saml: {
        title: 'SAML',
        message: 'Sign in using SAML',
      },
    },
  },
};

/**
 * Translation reference for Quickstart plugin
 * @public
 */
export const rhdhTranslationRef = createTranslationRef({
  id: 'rhdh',
  messages: rhdhMessages,
});
