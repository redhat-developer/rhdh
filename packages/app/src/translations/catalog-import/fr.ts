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
import { catalogImportTranslationRef } from '@backstage/plugin-catalog-import/alpha';

export default createTranslationMessages({
  ref: catalogImportTranslationRef,
  full: false,
  messages: {
    'defaultImportPage.headerTitle': 'Importer un dépôt Git existant',
    'importInfoCard.title': 'Importer un dépôt Git existant',
    'buttons.back': 'Arrière',
    'defaultImportPage.contentHeaderTitle':
      'Commencez à suivre votre composant dans {{appTitle}}',
    'defaultImportPage.supportTitle':
      "Commencez à suivre votre composant dans {{appTitle}} en l'ajoutant au catalogue de logiciels.",
    'importInfoCard.deepLinkTitle':
      'En savoir plus sur le catalogue de logiciels',
    'importInfoCard.linkDescription':
      "Saisissez l'URL de votre référentiel de code source pour l'ajouter à {{appTitle}}.",
    'importInfoCard.fileLinkTitle': "Lien vers un fichier d'entité existant",
    'importInfoCard.examplePrefix': 'Exemple: ',
    'importInfoCard.fileLinkDescription':
      "L'assistant analyse le fichier, prévisualise les entités et les ajoute au catalogue {{appTitle}}.",
    'importInfoCard.githubIntegration.title': 'Lien vers un référentiel',
    'importInfoCard.githubIntegration.label': 'GitHub uniquement',
    'importInfoCard.exampleDescription':
      "L'assistant découvre tous les fichiers {{catalogFilename}} dans le référentiel, prévisualise les entités et les ajoute au catalogue {{appTitle}}.",
    'importInfoCard.preparePullRequestDescription':
      "Si aucune entité n'est trouvée, l'assistant préparera une Pull Request qui ajoute un exemple de {{catalogFilename}} et prépare le catalogue {{appTitle}} pour charger toutes les entités dès que la Pull Request est fusionnée.",
    'importStepper.singleLocation.title': 'Sélectionner des emplacements',
    'importStepper.singleLocation.description': 'Lieux découverts : 1',
    'importStepper.multipleLocations.title': 'Sélectionner des emplacements',
    'importStepper.multipleLocations.description':
      'Lieux découverts : {{length, number}}',
    'importStepper.noLocation.title': "Créer une demande d'extraction",
    'importStepper.noLocation.createPr.detailsTitle':
      "Détails de la demande d'extraction",
    'importStepper.noLocation.createPr.titleLabel':
      "Titre de la demande d'extraction",
    'importStepper.noLocation.createPr.titlePlaceholder':
      "Ajouter des fichiers descripteurs d'entités de catalogue Backstage",
    'importStepper.noLocation.createPr.bodyLabel':
      "Corps de la demande d'extraction",
    'importStepper.noLocation.createPr.bodyPlaceholder':
      'Un texte descriptif avec prise en charge Markdown',
    'importStepper.noLocation.createPr.configurationTitle':
      "Configuration de l'entité",
    'importStepper.noLocation.createPr.componentNameLabel':
      'Nom du composant créé',
    'importStepper.noLocation.createPr.componentNamePlaceholder':
      'mon-composant',
    'importStepper.noLocation.createPr.ownerLoadingText':
      'Chargement des groupes…',
    'importStepper.noLocation.createPr.ownerHelperText':
      'Sélectionnez un propriétaire dans la liste ou entrez une référence à un groupe ou à un utilisateur',
    'importStepper.noLocation.createPr.ownerErrorHelperText': 'valeur requise',
    'importStepper.noLocation.createPr.ownerLabel': "Propriétaire de l'entité",
    'importStepper.noLocation.createPr.ownerPlaceholder': 'mon-groupe',
    'importStepper.noLocation.createPr.codeownersHelperText':
      "AVERTISSEMENT : cette opération peut échouer si aucun fichier CODEOWNERS n'est trouvé à l'emplacement cible.",
    'importStepper.analyze.title': "Sélectionnez l'URL",
    'importStepper.prepare.title': "Actions d'importation",
    'importStepper.prepare.description': 'Facultatif',
    'importStepper.review.title': 'Revoir',
    'importStepper.finish.title': 'Finition',
    'stepFinishImportLocation.backButtonText': 'Enregistrer un autre',
    'stepFinishImportLocation.repository.title':
      'La Pull Request suivante a été ouverte : ',
    'stepFinishImportLocation.repository.description':
      'Vos entités seront importées dès que la Pull Request sera fusionnée.',
    'stepFinishImportLocation.locations.new':
      'Les entités suivantes ont été ajoutées au catalogue :',
    'stepFinishImportLocation.locations.existing':
      'Une actualisation a été déclenchée pour les emplacements suivants :',
    'stepFinishImportLocation.locations.viewButtonText':
      'Afficher le composant',
    'stepFinishImportLocation.locations.backButtonText': 'Enregistrer un autre',
    'stepInitAnalyzeUrl.error.repository':
      'Impossible de générer des entités pour votre référentiel',
    'stepInitAnalyzeUrl.error.locations':
      "Il n'y a aucune entité à cet endroit",
    'stepInitAnalyzeUrl.error.default':
      "Résultat d'analyse inconnu reçu de type {{type}}. Veuillez contacter l'équipe d'assistance.",
    'stepInitAnalyzeUrl.error.url': 'Doit commencer par http:// ou https://.',
    'stepInitAnalyzeUrl.urlHelperText':
      "Saisissez le chemin complet vers votre fichier d'entité pour commencer à suivre votre composant",
    'stepInitAnalyzeUrl.nextButtonText': 'Analyser',
    'stepPrepareCreatePullRequest.description':
      "Vous avez entré un lien vers un référentiel {{integrationType}} mais aucun {{catalogFilename}} n'a pu être trouvé. Utilisez ce formulaire pour ouvrir une Pull Request qui en crée une.",
    'stepPrepareCreatePullRequest.previewPr.title':
      "Aperçu de la demande d'extraction",
    'stepPrepareCreatePullRequest.previewPr.subheader':
      'Créer une nouvelle Pull Request',
    'stepPrepareCreatePullRequest.previewCatalogInfo.title':
      'Aperçu des entités',
    'stepPrepareCreatePullRequest.nextButtonText':
      'Créer des relations publiques',
    'stepPrepareSelectLocations.locations.description':
      'Sélectionnez un ou plusieurs emplacements présents dans votre dépôt git :',
    'stepPrepareSelectLocations.locations.selectAll': 'Sélectionner tout',
    'stepPrepareSelectLocations.existingLocations.description':
      'Ces emplacements existent déjà dans le catalogue :',
    'stepPrepareSelectLocations.nextButtonText': 'Revoir',
    'stepReviewLocation.prepareResult.title':
      'La Pull Request suivante a été ouverte : ',
    'stepReviewLocation.prepareResult.description':
      "Vous pouvez déjà importer l'emplacement et {{appTitle}} récupérera les entités dès que la Pull Request sera fusionnée.",
    'stepReviewLocation.catalog.exists':
      'Les emplacements suivants existent déjà dans le catalogue :',
    'stepReviewLocation.catalog.new':
      'Les entités suivantes seront ajoutées au catalogue :',
    'stepReviewLocation.refresh': 'Rafraîchir',
    'stepReviewLocation.import': 'Importer',
  },
});
