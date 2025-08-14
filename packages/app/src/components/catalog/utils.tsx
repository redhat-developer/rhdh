import { type Entity } from '@backstage/catalog-model';

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
