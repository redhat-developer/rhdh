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
import { scaffolderTranslationRef } from '@backstage/plugin-scaffolder/alpha';

export default createTranslationMessages({
  ref: scaffolderTranslationRef,
  full: false,
  messages: {
    'templateListPage.contentHeader.registerExistingButtonTitle':
      'Importer un dépôt Git existant',
    'aboutCard.launchTemplate': 'Modèle de lancement',
    'actionsPage.title': 'Actions installées',
    'actionsPage.pageTitle': 'Créer un nouveau composant',
    'actionsPage.subtitle':
      "Il s'agit de la collection de toutes les actions installées",
    'actionsPage.content.emptyState.title': 'Aucune information à afficher',
    'actionsPage.content.emptyState.description':
      "Aucune action n'est installée ou il y a eu un problème de communication avec le backend.",
    'actionsPage.content.searchFieldPlaceholder': 'Rechercher une action',
    'actionsPage.action.input': 'Saisir',
    'actionsPage.action.output': 'Sortir',
    'actionsPage.action.examples': 'Exemples',
    'fields.entityNamePicker.title': 'Nom',
    'fields.entityNamePicker.description': 'Nom unique du composant',
    'fields.entityPicker.title': 'Entité',
    'fields.entityPicker.description': 'Une entité du catalogue',
    'fields.entityTagsPicker.title': 'Mots-clés',
    'fields.entityTagsPicker.description':
      'Ajoutez toutes les balises pertinentes, appuyez sur « Entrée » pour ajouter de nouvelles balises. Format valide : [a-z0-9+#] séparés par [-], au maximum 63 caractères',
    'fields.multiEntityPicker.title': 'Entité',
    'fields.multiEntityPicker.description': 'Une entité du catalogue',
    'fields.myGroupsPicker.title': 'Entité',
    'fields.myGroupsPicker.description': 'Une entité du catalogue',
    'fields.ownedEntityPicker.title': 'Entité',
    'fields.ownedEntityPicker.description': 'Une entité du catalogue',
    'fields.ownerPicker.title': 'Propriétaire',
    'fields.ownerPicker.description': 'Le propriétaire du composant',
    'fields.azureRepoPicker.organization.title': 'Organisation',
    'fields.azureRepoPicker.organization.description':
      "L'organisation à laquelle appartiendra ce dépôt",
    'fields.azureRepoPicker.project.title': 'Projet',
    'fields.azureRepoPicker.project.description':
      'Le projet auquel ce dépôt appartiendra',
    'fields.bitbucketRepoPicker.workspaces.title':
      'Espaces de travail autorisés',
    'fields.bitbucketRepoPicker.workspaces.inputTitle': 'Espaces de travail',
    'fields.bitbucketRepoPicker.workspaces.description':
      "L'espace de travail auquel ce dépôt appartiendra",
    'fields.bitbucketRepoPicker.project.title': 'Projets autorisés',
    'fields.bitbucketRepoPicker.project.inputTitle': 'Projets',
    'fields.bitbucketRepoPicker.project.description':
      'Le projet auquel ce dépôt appartiendra',
    'fields.gerritRepoPicker.owner.title': 'Propriétaire',
    'fields.gerritRepoPicker.owner.description':
      'Le propriétaire du projet (facultatif)',
    'fields.gerritRepoPicker.parent.title': 'Mère',
    'fields.gerritRepoPicker.parent.description':
      'Le parent du projet auquel appartiendra le dépôt',
    'fields.giteaRepoPicker.owner.title': 'Propriétaire disponible',
    'fields.giteaRepoPicker.owner.inputTitle': 'Propriétaire',
    'fields.giteaRepoPicker.owner.description':
      'Espace de noms Gitea auquel appartiendra ce dépôt. Il peut s’agir du nom d’une organisation, d’un groupe, d’un sous-groupe, d’un utilisateur ou du projet.',
    'fields.githubRepoPicker.owner.title': 'Propriétaire disponible',
    'fields.githubRepoPicker.owner.inputTitle': 'Propriétaire',
    'fields.githubRepoPicker.owner.description':
      "L'organisation, l'utilisateur ou le projet auquel ce dépôt appartiendra",
    'fields.gitlabRepoPicker.owner.title': 'Propriétaire disponible',
    'fields.gitlabRepoPicker.owner.inputTitle': 'Propriétaire',
    'fields.gitlabRepoPicker.owner.description':
      'Espace de noms GitLab auquel appartiendra ce référentiel. Il peut s’agir du nom d’une organisation, d’un groupe, d’un sous-groupe, d’un utilisateur ou du projet.',
    'fields.repoUrlPicker.host.title': 'Hôte',
    'fields.repoUrlPicker.host.description':
      "L'hôte où le référentiel sera créé",
    'fields.repoUrlPicker.repository.title': 'Dépôts disponibles',
    'fields.repoUrlPicker.repository.inputTitle': 'Dépôt',
    'fields.repoUrlPicker.repository.description': 'Le nom du référentiel',
    'listTaskPage.title': 'Liste des tâches du modèle',
    'listTaskPage.pageTitle': 'Modèles de tâches',
    'listTaskPage.subtitle': 'Toutes les tâches qui ont été commencées',
    'listTaskPage.content.emptyState.title': 'Aucune information à afficher',
    'listTaskPage.content.emptyState.description':
      "Il n'y a aucune tâche ou il y a eu un problème de communication avec le backend.",
    'listTaskPage.content.tableTitle': 'Tâches',
    'listTaskPage.content.tableCell.taskID': 'ID de tâche',
    'listTaskPage.content.tableCell.template': 'Modèle',
    'listTaskPage.content.tableCell.created': 'Créé',
    'listTaskPage.content.tableCell.owner': 'Propriétaire',
    'listTaskPage.content.tableCell.status': 'Statut',
    'ownerListPicker.title': 'Propriétaire de la tâche',
    'ownerListPicker.options.owned': 'Possédé',
    'ownerListPicker.options.all': 'Tous',
    'ongoingTask.title': 'Course de',
    'ongoingTask.pageTitle.hasTemplateName': 'Série de {{templateName}}',
    'ongoingTask.pageTitle.noTemplateName': "Course d'échafaudeurs",
    'ongoingTask.subtitle': 'Tâche {{taskId}}',
    'ongoingTask.cancelButtonTitle': 'Annuler',
    'ongoingTask.retryButtonTitle': 'Réessayer',
    'ongoingTask.startOverButtonTitle': 'Recommencer',
    'ongoingTask.hideLogsButtonTitle': 'Masquer les journaux',
    'ongoingTask.showLogsButtonTitle': 'Afficher les journaux',
    'ongoingTask.contextMenu.hideLogs': 'Masquer les journaux',
    'ongoingTask.contextMenu.showLogs': 'Afficher les journaux',
    'ongoingTask.contextMenu.hideButtonBar': 'Masquer la barre de boutons',
    'ongoingTask.contextMenu.retry': 'Réessayer',
    'ongoingTask.contextMenu.showButtonBar': 'Afficher la barre de boutons',
    'ongoingTask.contextMenu.startOver': 'Recommencer',
    'ongoingTask.contextMenu.cancel': 'Annuler',
    'templateEditorForm.stepper.emptyText':
      "Il n'y a aucun paramètre de spécification dans le modèle à prévisualiser.",
    'renderSchema.tableCell.name': 'Nom',
    'renderSchema.tableCell.title': 'Titre',
    'renderSchema.tableCell.description': 'Description',
    'renderSchema.tableCell.type': 'Taper',
    'renderSchema.undefined': 'Aucun schéma défini',
    'templatingExtensions.title': 'Extensions de modèles',
    'templatingExtensions.pageTitle': 'Extensions de modèles',
    'templatingExtensions.subtitle':
      "Il s'agit de la collection d'extensions de modèles disponibles",
    'templatingExtensions.content.emptyState.title':
      'Aucune information à afficher',
    'templatingExtensions.content.emptyState.description':
      "Aucune extension de modèle n'est disponible ou il y a eu un problème de communication avec le backend.",
    'templatingExtensions.content.searchFieldPlaceholder':
      'Rechercher une extension',
    'templatingExtensions.content.filters.title': 'Filtres',
    'templatingExtensions.content.filters.notAvailable':
      "Aucun filtre de modèle n'est défini.",
    'templatingExtensions.content.filters.metadataAbsent':
      'Les métadonnées du filtre ne sont pas disponibles',
    'templatingExtensions.content.filters.schema.input': 'Saisir',
    'templatingExtensions.content.filters.schema.arguments': 'Arguments',
    'templatingExtensions.content.filters.schema.output': 'Sortir',
    'templatingExtensions.content.filters.examples': 'Exemples',
    'templatingExtensions.content.functions.title': 'Fonctions',
    'templatingExtensions.content.functions.notAvailable':
      "Aucune fonction de modèle globale n'est définie.",
    'templatingExtensions.content.functions.metadataAbsent':
      'Métadonnées de fonction indisponibles',
    'templatingExtensions.content.functions.schema.arguments': 'Arguments',
    'templatingExtensions.content.functions.schema.output': 'Sortir',
    'templatingExtensions.content.functions.examples': 'Exemples',
    'templatingExtensions.content.values.title': 'Valeurs',
    'templatingExtensions.content.values.notAvailable':
      "Aucune valeur de modèle globale n'est définie.",
    'templateTypePicker.title': 'Catégories',
    'templateIntroPage.title': 'Gérer les modèles',
    'templateIntroPage.subtitle':
      'Modifiez, prévisualisez et essayez des modèles, des formulaires et des champs personnalisés',
    'templateFormPage.title': 'Éditeur de modèles',
    'templateFormPage.subtitle':
      'Modifier, prévisualiser et tester des modèles de formulaires',
    'templateCustomFieldPage.title': 'Explorateur de champs personnalisés',
    'templateCustomFieldPage.subtitle':
      'Modifier, prévisualiser et tester les champs personnalisés',
    'templateEditorPage.title': 'Éditeur de modèles',
    'templateEditorPage.subtitle':
      'Modifier, prévisualiser et tester des modèles et des formulaires de modèles',
    'templateEditorPage.dryRunResults.title': "Résultats de l'essai à blanc",
    'templateEditorPage.dryRunResultsList.title': 'Résultat {{resultId}}',
    'templateEditorPage.dryRunResultsList.downloadButtonTitle':
      'Télécharger au format .zip',
    'templateEditorPage.dryRunResultsList.deleteButtonTitle':
      'Supprimer le résultat',
    'templateEditorPage.dryRunResultsView.tab.files': 'Fichiers',
    'templateEditorPage.dryRunResultsView.tab.log': 'Enregistrer',
    'templateEditorPage.dryRunResultsView.tab.output': 'Sortir',
    'templateEditorPage.taskStatusStepper.skippedStepTitle': 'Ignoré',
    'templateEditorPage.customFieldExplorer.selectFieldLabel':
      'Choisissez une extension de champ personnalisée',
    'templateEditorPage.customFieldExplorer.fieldForm.title':
      'Options de champ',
    'templateEditorPage.customFieldExplorer.fieldForm.applyButtonTitle':
      'Appliquer',
    'templateEditorPage.customFieldExplorer.fieldPreview.title':
      'Aperçu du terrain',
    'templateEditorPage.customFieldExplorer.preview.title':
      'Spécifications du modèle',
    'templateEditorPage.templateEditorBrowser.closeConfirmMessage':
      'Es-tu sûr? Les modifications non enregistrées seront perdues',
    'templateEditorPage.templateEditorBrowser.saveIconTooltip':
      'Enregistrer tous les fichiers',
    'templateEditorPage.templateEditorBrowser.reloadIconTooltip':
      'Recharger le répertoire',
    'templateEditorPage.templateEditorBrowser.closeIconTooltip':
      'Fermer le répertoire',
    'templateEditorPage.templateEditorIntro.title':
      "Commencez par choisir l'une des options ci-dessous",
    'templateEditorPage.templateEditorIntro.loadLocal.title':
      'Charger le répertoire des modèles',
    'templateEditorPage.templateEditorIntro.loadLocal.description':
      "Chargez un répertoire de modèles local, vous permettant à la fois de modifier et d'essayer d'exécuter votre propre modèle.",
    'templateEditorPage.templateEditorIntro.loadLocal.unsupportedTooltip':
      'Uniquement pris en charge dans certains navigateurs basés sur Chromium avec la page chargée via HTTPS',
    'templateEditorPage.templateEditorIntro.createLocal.title':
      'Créer un nouveau modèle',
    'templateEditorPage.templateEditorIntro.createLocal.description':
      "Créez un répertoire de modèles local, vous permettant à la fois de modifier et d'essayer d'exécuter votre propre modèle.",
    'templateEditorPage.templateEditorIntro.createLocal.unsupportedTooltip':
      'Uniquement pris en charge dans certains navigateurs basés sur Chromium avec la page chargée via HTTPS',
    'templateEditorPage.templateEditorIntro.formEditor.title':
      'Modèle de formulaire de terrain de jeu',
    'templateEditorPage.templateEditorIntro.formEditor.description':
      'Prévisualisez et modifiez un modèle de formulaire, soit en utilisant un exemple de modèle, soit en chargeant un modèle à partir du catalogue.',
    'templateEditorPage.templateEditorIntro.fieldExplorer.title':
      'Explorateur de champs personnalisés',
    'templateEditorPage.templateEditorIntro.fieldExplorer.description':
      'Affichez et jouez avec les extensions de champs personnalisés installées disponibles.',
    'templateEditorPage.templateEditorTextArea.saveIconTooltip':
      'Enregistrer le fichier',
    'templateEditorPage.templateEditorTextArea.refreshIconTooltip':
      'Recharger le fichier',
    'templateEditorPage.templateEditorTextArea.emptyStateParagraph':
      'Veuillez sélectionner une action dans le menu fichier.',
    'templateEditorPage.templateFormPreviewer.title':
      'Charger le modèle existant',
    'templateListPage.title': 'Créer un nouveau composant',
    'templateListPage.subtitle':
      "Créez de nouveaux composants logiciels à l'aide de modèles standard dans votre organisation",
    'templateListPage.pageTitle': 'Créer un nouveau composant',
    'templateListPage.templateGroups.defaultTitle': 'Modèles',
    'templateListPage.templateGroups.otherTitle': 'Autres modèles',
    'templateListPage.contentHeader.supportButtonTitle':
      'Créez de nouveaux composants logiciels à l’aide de modèles standard. Différents modèles créent différents types de composants (services, sites Web, documentation, ...).',
    'templateListPage.additionalLinksForEntity.viewTechDocsTitle':
      'Voir TechDocs',
    'templateWizardPage.title': 'Créer un nouveau composant',
    'templateWizardPage.subtitle':
      "Créez de nouveaux composants logiciels à l'aide de modèles standard dans votre organisation",
    'templateWizardPage.pageTitle': 'Créer un nouveau composant',
    'templateWizardPage.pageContextMenu.editConfigurationTitle':
      'Modifier la configuration',
    'templateEditorToolbar.customFieldExplorerTooltip':
      'Explorateur de champs personnalisés',
    'templateEditorToolbar.installedActionsDocumentationTooltip':
      'Documentation des actions installées',
    'templateEditorToolbar.templatingExtensionsDocumentationTooltip':
      'Documentation des extensions de modèles',
    'templateEditorToolbar.addToCatalogButton': 'Publier',
    'templateEditorToolbar.addToCatalogDialogTitle':
      'Publier les modifications',
    'templateEditorToolbar.addToCatalogDialogContent.stepsIntroduction':
      'Suivez les instructions ci-dessous pour créer ou mettre à jour un modèle :',
    'templateEditorToolbar.addToCatalogDialogContent.stepsListItems':
      "Enregistrez les fichiers de modèle dans un répertoire local Créez une demande d'extraction vers un dépôt git nouveau ou existant Si le modèle existe déjà, les modifications seront reflétées dans le catalogue de logiciels une fois la demande d'extraction fusionnée Mais si vous créez un nouveau modèle, suivez la documentation liée ci-dessous pour enregistrer le nouveau dépôt de modèles dans le catalogue de logiciels",
    'templateEditorToolbar.addToCatalogDialogActions.documentationButton':
      'Accéder à la documentation',
    'templateEditorToolbar.addToCatalogDialogActions.documentationUrl':
      'https://backstage.io/docs/features/software-templates/adding-templates/',
    'templateEditorToolbarFileMenu.button': 'Déposer',
    'templateEditorToolbarFileMenu.options.openDirectory':
      'Ouvrir le répertoire des modèles',
    'templateEditorToolbarFileMenu.options.createDirectory':
      'Créer un répertoire de modèles',
    'templateEditorToolbarFileMenu.options.closeEditor':
      "Fermer l'éditeur de modèles",
    'templateEditorToolbarTemplatesMenu.button': 'Modèles',
  },
});
