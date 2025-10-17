import { Entity } from '@backstage/catalog-model';
import { isKind } from '@backstage/plugin-catalog';

import { isType } from '../utils';
import { ApiTabContent } from './ApiTabContent';
import { DefinitionTabContent } from './DefinitionTabContent';
import { DependenciesTabContent } from './DependenciesTabContent';
import { DiagramTabContent } from './DiagramTabContent';
import { DynamicEntityTabProps } from './DynamicEntityTab';
import { OverviewTabContent } from './OverviewTabContent';

/**
 * The default set of entity tabs in the default order
 */
export const defaultTabs: Record<
  string,
  Omit<DynamicEntityTabProps, 'if' | 'children' | 'path'>
> = {
  '/': {
    title: 'Overview',
    titleKey: 'catalog.entityPage.overview.title',
    mountPoint: 'entity.page.overview',
  },
  '/topology': {
    title: 'Topology',
    titleKey: 'catalog.entityPage.topology.title',
    mountPoint: 'entity.page.topology',
  },
  '/issues': {
    title: 'Issues',
    titleKey: 'catalog.entityPage.issues.title',
    mountPoint: 'entity.page.issues',
  },
  '/pr': {
    title: 'Pull/Merge Requests',
    titleKey: 'catalog.entityPage.pullRequests.title',
    mountPoint: 'entity.page.pull-requests',
  },
  '/ci': {
    title: 'CI',
    titleKey: 'catalog.entityPage.ci.title',
    mountPoint: 'entity.page.ci',
  },
  '/cd': {
    title: 'CD',
    titleKey: 'catalog.entityPage.cd.title',
    mountPoint: 'entity.page.cd',
  },
  '/kubernetes': {
    title: 'Kubernetes',
    titleKey: 'catalog.entityPage.kubernetes.title',
    mountPoint: 'entity.page.kubernetes',
  },
  '/image-registry': {
    title: 'Image Registry',
    titleKey: 'catalog.entityPage.imageRegistry.title',
    mountPoint: 'entity.page.image-registry',
  },
  '/monitoring': {
    title: 'Monitoring',
    titleKey: 'catalog.entityPage.monitoring.title',
    mountPoint: 'entity.page.monitoring',
  },
  '/lighthouse': {
    title: 'Lighthouse',
    titleKey: 'catalog.entityPage.lighthouse.title',
    mountPoint: 'entity.page.lighthouse',
  },
  '/api': {
    title: 'Api',
    titleKey: 'catalog.entityPage.api.title',
    mountPoint: 'entity.page.api',
  },
  '/dependencies': {
    title: 'Dependencies',
    titleKey: 'catalog.entityPage.dependencies.title',
    mountPoint: 'entity.page.dependencies',
  },
  '/docs': {
    title: 'Docs',
    titleKey: 'catalog.entityPage.docs.title',
    mountPoint: 'entity.page.docs',
  },
  '/definition': {
    title: 'Definition',
    titleKey: 'catalog.entityPage.definition.title',
    mountPoint: 'entity.page.definition',
  },
  '/system': {
    title: 'Diagram',
    titleKey: 'catalog.entityPage.diagram.title',
    mountPoint: 'entity.page.diagram',
  },
};

/**
 * Additional tab visibility rules for specific entity routes
 */
export const tabRules: Record<
  string,
  Omit<DynamicEntityTabProps, 'path' | 'title' | 'mountPoint' | 'children'>
> = {
  '/api': {
    if: (entity: Entity) =>
      isType('service')(entity) && isKind('component')(entity),
  },
  '/dependencies': {
    if: isKind('component'),
  },
  '/definition': {
    if: isKind('api'),
  },
  '/system': {
    if: isKind('system'),
  },
};

/**
 * Additional child elements to be rendered at specific entity routes
 */
export const tabChildren: Record<
  string,
  Omit<DynamicEntityTabProps, 'path' | 'title' | 'mountPoint' | 'if'>
> = {
  '/': {
    children: <OverviewTabContent />,
  },
  '/api': {
    children: <ApiTabContent />,
  },
  '/dependencies': {
    children: <DependenciesTabContent />,
  },
  '/definition': {
    children: <DefinitionTabContent />,
  },
  '/system': {
    children: <DiagramTabContent />,
  },
};
