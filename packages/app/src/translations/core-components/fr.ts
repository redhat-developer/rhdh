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

import { coreComponentsTranslationRef } from '@backstage/core-components/alpha';
import { createTranslationMessages } from '@backstage/core-plugin-api/alpha';

export default createTranslationMessages({
  ref: coreComponentsTranslationRef,
  full: false,
  messages: {
    'table.filter.placeholder': 'Tous les résultats',
    'table.body.emptyDataSourceMessage': 'Aucun enregistrement à afficher',
    'table.pagination.firstTooltip': 'Première page',
    'table.pagination.labelDisplayedRows': '{de}-{à} de {count}',
    'table.pagination.labelRowsSelect': 'rangées',
    'table.pagination.lastTooltip': 'Dernière page',
    'table.pagination.nextTooltip': 'Page suivante',
    'table.pagination.previousTooltip': 'Page précédente',
    'table.toolbar.search': 'Filtre',
    'alertDisplay.message_one': '({{ count }} message plus récent)',
    'alertDisplay.message_other': '({{ count }} messages plus récents)',
    'table.header.actions': 'Actes',
    'oauthRequestDialog.message':
      'Connectez-vous pour autoriser {{appTitle}} à accéder aux API et identités de {{provider}}.',
    'signIn.title': 'Se connecter',
    'signIn.loginFailed': 'La connexion a échoué',
    'signIn.customProvider.title': 'Utilisateur personnalisé',
    'signIn.customProvider.subtitle':
      "Saisissez votre propre identifiant utilisateur et vos informations d'identification. Cette sélection ne sera pas enregistrée.",
    'signIn.customProvider.userId': "ID de l'utilisateur",
    'signIn.customProvider.tokenInvalid':
      "Le jeton n'est pas un jeton JWT OpenID Connect valide",
    'signIn.customProvider.continue': 'Continuer',
    'signIn.customProvider.idToken': "Jeton d'identification (facultatif)",
    'signIn.guestProvider.title': 'Invité',
    'signIn.guestProvider.subtitle':
      "Entrez en tant qu'utilisateur invité. Votre identité n'aura pas été vérifiée, ce qui signifie que certaines fonctionnalités pourraient ne pas être disponibles.",
    'signIn.guestProvider.enter': 'Entrer',
    skipToContent: 'Accéder au contenu',
    'copyTextButton.tooltipText': 'Texte copié dans le presse-papiers',
    'simpleStepper.reset': 'Réinitialiser',
    'simpleStepper.finish': 'Finition',
    'simpleStepper.next': 'Suivant',
    'simpleStepper.skip': 'Ignorer',
    'simpleStepper.back': 'Arrière',
    'errorPage.subtitle': 'ERREUR {{status}} : {{statusMessage}}',
    'errorPage.title': "On dirait que quelqu'un a laissé tomber le micro !",
    'errorPage.goBack': 'Retour',
    'errorPage.showMoreDetails': 'Afficher plus de détails',
    'errorPage.showLessDetails': 'Afficher moins de détails',
    'emptyState.missingAnnotation.title': 'Annotation manquante',
    'emptyState.missingAnnotation.actionTitle':
      "Ajoutez l'annotation à votre composant YAML comme indiqué dans l'exemple en surbrillance ci-dessous :",
    'emptyState.missingAnnotation.readMore': 'En savoir plus',
    'supportConfig.default.title': 'Support non configuré',
    'supportConfig.default.linkTitle':
      'Ajouter la clé de configuration « app.support »',
    'errorBoundary.title':
      "Veuillez contacter {{slackChannel}} pour obtenir de l'aide.",
    'oauthRequestDialog.title': 'Connexion requise',
    'oauthRequestDialog.authRedirectTitle':
      'Cela déclenchera une redirection http vers la connexion OAuth.',
    'oauthRequestDialog.login': 'Connexion',
    'oauthRequestDialog.rejectAll': 'Tout rejeter',
    'supportButton.title': 'Support',
    'supportButton.close': 'Fermer',
    'table.filter.title': 'Filtres',
    'table.filter.clearAll': 'Tout effacer',
    'autoLogout.stillTherePrompt.title': "Déconnexion en raison d'inactivité",
    'autoLogout.stillTherePrompt.buttonText': 'Oui! Ne me déconnectez pas',
    'proxiedSignInPage.title':
      'Vous ne semblez pas être connecté. Veuillez essayer de recharger la page du navigateur.',
  },
});
