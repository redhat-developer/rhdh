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
import { catalogTranslationRef } from '@backstage/plugin-catalog/alpha';

export default createTranslationMessages({
  ref: catalogTranslationRef,
  full: false,
  messages: {
    'indexPage.createButtonTitle': 'Self-service',
    'indexPage.title': 'Catalogue {{orgName}}',
    'indexPage.supportButtonContent':
      'Toutes les entités de votre catalogue de logiciels',
    'aboutCard.title': 'À propos',
    'aboutCard.refreshButtonTitle':
      "Actualisation de l'entité de planification",
    'aboutCard.editButtonTitle': 'Modifier les métadonnées',
    'aboutCard.createSimilarButtonTitle': 'Créer quelque chose de similaire',
    'aboutCard.refreshScheduledMessage': 'Actualisation programmée',
    'aboutCard.launchTemplate': 'Modèle de lancement',
    'aboutCard.viewTechdocs': 'Voir TechDocs',
    'aboutCard.viewSource': 'Voir la source',
    'aboutCard.descriptionField.label': 'Description',
    'aboutCard.descriptionField.value': 'Aucune description',
    'aboutCard.ownerField.label': 'Propriétaire',
    'aboutCard.ownerField.value': 'Pas de propriétaire',
    'aboutCard.domainField.label': 'Domaine',
    'aboutCard.domainField.value': 'Pas de domaine',
    'aboutCard.systemField.label': 'Système',
    'aboutCard.systemField.value': 'Pas de système',
    'aboutCard.parentComponentField.label': 'Composant parent',
    'aboutCard.parentComponentField.value': 'Aucun composant parent',
    'aboutCard.typeField.label': 'Taper',
    'aboutCard.lifecycleField.label': 'Cycle de vie',
    'aboutCard.tagsField.label': 'Mots-clés',
    'aboutCard.tagsField.value': 'Aucune balise',
    'aboutCard.targetsField.label': 'Cibles',
    'searchResultItem.lifecycle': 'Cycle de vie',
    'searchResultItem.Owner': 'Propriétaire',
    'catalogTable.warningPanelTitle':
      'Impossible de récupérer les entités du catalogue.',
    'catalogTable.viewActionTitle': 'Voir',
    'catalogTable.editActionTitle': 'Modifier',
    'catalogTable.starActionTitle': 'Ajouter aux favoris',
    'catalogTable.unStarActionTitle': 'Supprimer des favoris',
    'dependencyOfComponentsCard.title': 'Dépendance des composants',
    'dependencyOfComponentsCard.emptyMessage':
      'Aucun composant ne dépend de ce composant',
    'dependsOnComponentsCard.title': 'Cela dépend des composants',
    'dependsOnComponentsCard.emptyMessage':
      "Aucun composant n'est une dépendance de ce composant",
    'dependsOnResourcesCard.title': 'Cela dépend des ressources',
    'dependsOnResourcesCard.emptyMessage':
      "Aucune ressource n'est une dépendance de ce composant",
    'entityContextMenu.copiedMessage': 'Copié!',
    'entityContextMenu.moreButtonTitle': 'Plus',
    'entityContextMenu.inspectMenuTitle': "Inspecter l'entité",
    'entityContextMenu.copyURLMenuTitle': "Copier l'URL de l'entité",
    'entityContextMenu.unregisterMenuTitle': "Désenregistrer l'entité",
    'entityLabelsCard.title': 'Étiquettes',
    'entityLabelsCard.emptyDescription':
      "Aucune étiquette définie pour cette entité. Vous pouvez ajouter des étiquettes à votre entité YAML comme indiqué dans l'exemple en surbrillance ci-dessous :",
    'entityLabelsCard.readMoreButtonTitle': 'En savoir plus',
    'entityLabels.warningPanelTitle': 'Entité non trouvée',
    'entityLabels.ownerLabel': 'Propriétaire',
    'entityLabels.lifecycleLabel': 'Cycle de vie',
    'entityLinksCard.title': 'Links',
    'entityLinksCard.emptyDescription':
      "Aucun lien défini pour cette entité. Vous pouvez ajouter des liens vers votre entité YAML comme indiqué dans l'exemple en surbrillance ci-dessous :",
    'entityLinksCard.readMoreButtonTitle': 'En savoir plus',
    'entityNotFound.title': "L'entité n'a pas été trouvée",
    'entityNotFound.description':
      'Vous voulez nous aider à construire cela ? Consultez notre documentation de mise en route.',
    'entityNotFound.docButtonTitle': 'DOCUMENTS',
    'deleteEntity.dialogTitle':
      'Êtes-vous sûr de vouloir supprimer cette entité ?',
    'deleteEntity.deleteButtonTitle': 'Supprimer',
    'deleteEntity.cancelButtonTitle': 'Annuler',
    'deleteEntity.description':
      "Cette entité n'est référencée par aucun emplacement et ne reçoit donc pas de mises à jour. Cliquez ici pour supprimer.",
    entityProcessingErrorsDescription: "L'erreur ci-dessous provient de",
    entityRelationWarningDescription:
      "Cette entité a des relations avec d'autres entités, qui ne peuvent pas être trouvées dans le catalogue. Les entités non trouvées sont : ",
    'hasComponentsCard.title': 'Contient des composants',
    'hasComponentsCard.emptyMessage':
      'Aucun composant ne fait partie de ce système',
    'hasResourcesCard.title': 'Dispose de ressources',
    'hasResourcesCard.emptyMessage':
      'Aucune ressource ne fait partie de ce système',
    'hasSubcomponentsCard.title': 'A des sous-composants',
    'hasSubcomponentsCard.emptyMessage':
      'Aucun sous-composant ne fait partie de ce composant',
    'hasSubdomainsCard.title': 'A des sous-domaines',
    'hasSubdomainsCard.emptyMessage':
      'Aucun sous-domaine ne fait partie de ce domaine',
    'hasSystemsCard.title': 'A des systèmes',
    'hasSystemsCard.emptyMessage': 'Aucun système ne fait partie de ce domaine',
    'relatedEntitiesCard.emptyHelpLinkTitle': 'Apprenez à changer cela',
    'systemDiagramCard.title': 'Diagramme du système',
    'systemDiagramCard.description':
      'Utilisez le pincement et le zoom pour vous déplacer dans le diagramme.',
    'systemDiagramCard.edgeLabels.partOf': 'une partie de',
    'systemDiagramCard.edgeLabels.provides': 'fournit',
    'systemDiagramCard.edgeLabels.dependsOn': 'dépend de',
  },
});
