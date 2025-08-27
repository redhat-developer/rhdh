import { type Entity } from '@backstage/catalog-model';
import { ApiHolder } from '@backstage/core-plugin-api';
import { isKind } from '@backstage/plugin-catalog';

import { hasAnnotation, isType } from '../utils';
import { MountPointConfigRawIf } from './types';

/**
 * Evaluate the supplied conditional map.  Used to determine the visibility of
 * tabs in the UI
 * @param conditional
 * @returns
 */
export function configIfToCallable(conditional: MountPointConfigRawIf) {
  return (entity: Entity, context?: { apis: ApiHolder }) => {
    if (conditional?.allOf) {
      return conditional.allOf
        .map(conditionsArrayMapper)
        .every(f => f(entity, context));
    }
    if (conditional?.anyOf) {
      return conditional.anyOf
        .map(conditionsArrayMapper)
        .some(f => f(entity, context));
    }
    if (conditional?.oneOf) {
      return (
        conditional.oneOf
          .map(conditionsArrayMapper)
          .filter(f => f(entity, context)).length === 1
      );
    }
    return true;
  };
}

export function conditionsArrayMapper(
  condition:
    | {
        [key: string]: string | string[];
      }
    | Function,
): (entity: Entity, context?: { apis: ApiHolder }) => boolean {
  if (typeof condition === 'function') {
    return (entity: Entity, context?: { apis: ApiHolder }): boolean =>
      condition(entity, context);
  }
  if (condition.isKind) {
    return isKind(condition.isKind);
  }
  if (condition.isType) {
    return isType(condition.isType);
  }
  if (condition.hasAnnotation) {
    return hasAnnotation(condition.hasAnnotation as string);
  }
  return () => false;
}
