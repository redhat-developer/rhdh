import {
  Entity,
  getCompoundEntityRef,
  parseEntityRef,
} from '@backstage/catalog-model';
import {
  CatalogProcessor,
  CatalogProcessorEmit,
  processingResult,
} from '@backstage/plugin-catalog-node';
import { LocationSpec } from '@backstage/plugin-catalog-common';
import { RELATION_SCAFFOLDER_OF, RELATION_SCAFFOLDED_FROM } from './relations';
import { ScaffoldedBySpec } from './types';

/** @public */
export class ScaffolderRelationEntityProcessor implements CatalogProcessor {
  getProcessorName(): string {
    return 'ScaffolderRelationEntityProcessor';
  }

  async postProcessEntity(
    entity: Entity,
    _location: LocationSpec,
    emit: CatalogProcessorEmit,
  ): Promise<Entity> {
    const selfRef = getCompoundEntityRef(entity);

    /**
     * Utilities
     */
    function doEmit(
      targets: string | string[] | undefined,
      context: { defaultKind?: string; defaultNamespace: string },
      outgoingRelation: string,
      incomingRelation: string,
    ): void {
      if (!targets) {
        return;
      }
      for (const target of [targets].flat()) {
        const targetRef = parseEntityRef(target, context);
        emit(
          processingResult.relation({
            source: selfRef,
            type: outgoingRelation,
            target: {
              kind: targetRef.kind,
              namespace: targetRef.namespace,
              name: targetRef.name,
            },
          }),
        );
        emit(
          processingResult.relation({
            source: {
              kind: targetRef.kind,
              namespace: targetRef.namespace,
              name: targetRef.name,
            },
            type: incomingRelation,
            target: selfRef,
          }),
        );
      }
    }

    /**
     * Emit relations for entities generated by templates (can be any entity type)
     */
    const arbitraryEntity = entity as Entity & Partial<ScaffoldedBySpec>;
    doEmit(
      arbitraryEntity.spec?.scaffoldedFrom,
      { defaultKind: 'Template', defaultNamespace: selfRef.namespace },
      RELATION_SCAFFOLDED_FROM,
      RELATION_SCAFFOLDER_OF,
    );
    return entity;
  }
}
