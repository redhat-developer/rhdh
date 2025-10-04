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
    'menuItem.userSettings': 'Benutzereinstellungen',
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

    'catalog.entityPage.overview.title': 'Übersicht',
    'catalog.entityPage.topology.title': 'Topologie',
    'catalog.entityPage.issues.title': 'Issues',
    'catalog.entityPage.pullRequests.title': 'Pull/Merge Requests',
    'catalog.entityPage.ci.title': 'CI',
    'catalog.entityPage.cd.title': 'CD',
    'catalog.entityPage.kubernetes.title': 'Kubernetes',
    'catalog.entityPage.imageRegistry.title': 'Image Registry',
    'catalog.entityPage.monitoring.title': 'Überwachung',
    'catalog.entityPage.lighthouse.title': 'Lighthouse',
    'catalog.entityPage.api.title': 'API',
    'catalog.entityPage.dependencies.title': 'Abhängigkeiten',
    'catalog.entityPage.docs.title': 'Dokumentation',
    'catalog.entityPage.definition.title': 'Definition',
    'catalog.entityPage.diagram.title': 'Systemdiagramm',
    'catalog.entityPage.workflows.title': 'Workflows',

    'sidebar.menu': 'Menü',
    'sidebar.home': 'Startseite',
    'sidebar.homeLogo': 'Startseite-Logo',

    // SignIn page translations
    'signIn.page.title': 'Anmeldeverfahren auswählen',
    'signIn.providers.auth0.title': 'Auth0',
    'signIn.providers.auth0.message': 'Mit Auth0 anmelden',
    'signIn.providers.atlassian.title': 'Atlassian',
    'signIn.providers.atlassian.message': 'Mit Atlassian anmelden',
    'signIn.providers.microsoft.title': 'Microsoft',
    'signIn.providers.microsoft.message': 'Mit Microsoft anmelden',
    'signIn.providers.bitbucket.title': 'Bitbucket',
    'signIn.providers.bitbucket.message': 'Mit Bitbucket anmelden',
    'signIn.providers.bitbucketServer.title': 'Bitbucket Server',
    'signIn.providers.bitbucketServer.message': 'Mit Bitbucket Server anmelden',
    'signIn.providers.github.title': 'GitHub',
    'signIn.providers.github.message': 'Mit GitHub anmelden',
    'signIn.providers.gitlab.title': 'GitLab',
    'signIn.providers.gitlab.message': 'Mit GitLab anmelden',
    'signIn.providers.google.title': 'Google',
    'signIn.providers.google.message': 'Mit Google anmelden',
    'signIn.providers.oidc.title': 'OIDC',
    'signIn.providers.oidc.message': 'Mit OIDC anmelden',
    'signIn.providers.okta.title': 'Okta',
    'signIn.providers.okta.message': 'Mit Okta anmelden',
    'signIn.providers.onelogin.title': 'OneLogin',
    'signIn.providers.onelogin.message': 'Mit OneLogin anmelden',
    'signIn.providers.saml.title': 'SAML',
    'signIn.providers.saml.message': 'Mit SAML anmelden',

    // App translations
    'app.scaffolder.title': 'Self-Service',
    'app.search.title': 'Suchen',
    'app.search.resultType': 'Ergebnistyp',
    'app.search.softwareCatalog': 'Software-Katalog',
    'app.search.filters.kind': 'Art',
    'app.search.filters.lifecycle': 'Lebenszyklus',
    'app.search.filters.component': 'Komponente',
    'app.search.filters.template': 'Vorlage',
    'app.search.filters.experimental': 'experimentell',
    'app.search.filters.production': 'produktionsreif',
    'app.learningPaths.title': 'Lernpfade',
    'app.learningPaths.error.title': 'Daten konnten nicht abgerufen werden.',
    'app.learningPaths.error.unknownError': 'Unbekannter Fehler',
    'app.userSettings.infoCard.title': 'RHDH-Metadaten',
    'app.userSettings.infoCard.metadataCopied':
      'Metadaten in die Zwischenablage kopiert',
    'app.userSettings.infoCard.copyMetadata':
      'Metadaten in die Zwischenablage kopieren',
    'app.userSettings.infoCard.showLess': 'Weniger anzeigen',
    'app.userSettings.infoCard.showMore': 'Mehr anzeigen',
    'app.errors.contactSupport': 'Support kontaktieren',
    'app.errors.goBack': 'Zurück',
    'app.errors.notFound.message': 'Diese Seite konnten wir nicht finden',
    'app.errors.notFound.additionalInfo':
      'Die gesuchte Seite wurde möglicherweise entfernt, umbenannt oder ist vorübergehend nicht verfügbar.',
    'app.table.createdAt': 'Erstellt am',
  },
});
