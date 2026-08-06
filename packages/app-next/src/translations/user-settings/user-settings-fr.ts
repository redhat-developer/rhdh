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
import { userSettingsTranslationRef } from '@backstage/plugin-user-settings';

export default createTranslationMessages({
  ref: userSettingsTranslationRef,
  full: false,
  messages: {
    sidebarTitle: 'Paramètres',
    'languageToggle.title': 'Langue',
    'languageToggle.description': 'Changer la langue',
    'languageToggle.select': 'Sélectionnez la langue {{language}}',
    'themeToggle.title': 'Thème',
    'themeToggle.description': 'Changer le mode thème',
    'themeToggle.select': 'Sélectionnez {{theme}}',
    'themeToggle.selectAuto': 'Sélectionner le thème automatique',
    'themeToggle.names.light': 'Clair',
    'themeToggle.names.dark': 'Sombre',
    'themeToggle.names.auto': 'Auto',
    'signOutMenu.title': 'Se déconnecter',
    'signOutMenu.moreIconTitle': 'davantage',
    'pinToggle.title': 'Épingler la barre latérale',
    'pinToggle.description': 'Empêcher la fermeture de la barre latérale',
    'pinToggle.switchTitles.unpin': 'Détacher la barre latérale',
    'pinToggle.switchTitles.pin': 'Épingler la barre latérale',
    'pinToggle.ariaLabelTitle': 'Commutateur de barre latérale à broches',
    'identityCard.title': 'Identité en coulisses',
    'identityCard.noIdentityTitle': 'Aucune identité en coulisses',
    'identityCard.userEntity': 'Entité utilisateur',
    'identityCard.ownershipEntities': 'Entités de propriété',
    'defaultProviderSettings.description':
      'Fournit une authentification auprès des API et des identités de {{provider}}',
    'emptyProviders.title': "Aucun fournisseur d'authentification",
    'emptyProviders.description':
      "Vous pouvez ajouter des fournisseurs d'authentification à Backstage, ce qui vous permet de les utiliser pour vous authentifier.",
    'emptyProviders.action.title':
      'Ouvrez le fichier app-config.yaml et effectuez les modifications indiquées ci-dessous :',
    'emptyProviders.action.readMoreButtonTitle': 'En savoir plus',
    'providerSettingsItem.title.signIn': 'Connectez-vous à {{title}}',
    'providerSettingsItem.title.signOut': 'Déconnexion de {{title}}',
    'providerSettingsItem.buttonTitle.signIn': 'Se connecter',
    'providerSettingsItem.buttonTitle.signOut': 'se déconnecter',
    'authProviders.title': 'Fournisseurs disponibles',
    'defaultSettingsPage.tabsTitle.general': 'Général',
    'defaultSettingsPage.tabsTitle.authProviders':
      "Fournisseurs d'authentification",
    'defaultSettingsPage.tabsTitle.featureFlags': 'Drapeaux de fonctionnalités',
    'featureFlags.title': 'Drapeaux de fonctionnalités',
    'featureFlags.description':
      'Veuillez actualiser la page lorsque vous modifiez les options de personnalisation.',
    'featureFlags.emptyFlags.title': 'Aucun indicateur de fonctionnalité',
    'featureFlags.emptyFlags.description':
      "Les indicateurs de fonctionnalités permettent aux plugins d'enregistrer des fonctionnalités dans Backstage afin que les utilisateurs puissent les activer. Vous pouvez utiliser cela pour séparer la logique de votre code pour les tests A/B manuels, etc.",
    'featureFlags.emptyFlags.action.title':
      "Un exemple de la manière d'ajouter un indicateur de fonctionnalité est présenté ci-dessous :",
    'featureFlags.emptyFlags.action.readMoreButtonTitle': 'En savoir plus',
    'featureFlags.filterTitle': 'Filtre',
    'featureFlags.clearFilter': 'Effacer le filtre',
    'featureFlags.flagItem.title.disable': 'Désactiver',
    'featureFlags.flagItem.title.enable': 'Activer',
    'featureFlags.flagItem.subtitle.registeredInApplication':
      "Enregistré dans l'application",
    'featureFlags.flagItem.subtitle.registeredInPlugin':
      'Enregistré dans le plugin {{pluginId}}',
    'settingsLayout.title': 'Paramètres',
    'profileCard.title': 'Profil',
    'appearanceCard.title': 'Apparence',
  },
});
