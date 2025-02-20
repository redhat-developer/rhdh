import { type Entity } from '@backstage/catalog-model';

import { defaultTabs } from './EntityPage/defaultTabs';
import { DynamicEntityTabProps } from './EntityPage/DynamicEntityTab';

export const isType = (types: string | string[]) => (entity: Entity) => {
  if (!entity?.spec?.type) {
    return false;
  }
  return typeof types === 'string'
    ? entity?.spec?.type === types
    : types.includes(entity.spec.type as string);
};
export const hasAnnotation = (keys: string) => (entity: Entity) =>
  Boolean(entity.metadata.annotations?.[keys]);

export const hasLinks = (entity: Entity) =>
  Boolean(entity.metadata.links?.length);

export const mergeTabs = (
  entityTabOverrides: Record<
    string,
    Omit<DynamicEntityTabProps, 'path' | 'if' | 'children'>
  >,
) => {
  return (
    Object.entries({ ...defaultTabs, ...entityTabOverrides })
      .filter(([, tab]) => !(tab.priority && tab.priority < 0))
      .sort(([, tabA], [, tabB]) => {
        const priorityA = tabA.priority ?? 0;
        const priorityB = tabB.priority ?? 0;
        return priorityB - priorityA;
      }) || []
  );
};
