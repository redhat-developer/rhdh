import { AuthService } from '@backstage/backend-plugin-api';
import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';

export class CatalogEntityStore {
  constructor(
    private readonly catalogClient: CatalogClient,
    private readonly auth: AuthService,
  ) {}

  async getUserEntities(): Promise<Map<string, Entity>> {
    const { token } = await this.auth.getPluginRequestToken({
      onBehalfOf: await this.auth.getOwnServiceCredentials(),
      targetPluginId: 'catalog',
    });
    const entities = await this.catalogClient.getEntities(
      {
        filter: { kind: 'User' },
        fields: [
          'metadata.name',
          'spec.profile.displayName',
          'spec.profile.email',
          'kind',
        ],
      },
      { token },
    );

    const entityMap: Map<string, Entity> = entities.items.reduce(
      (map: Map<string, Entity>, entity: Entity) => {
        if (entity.kind === 'User' && entity.metadata?.name) {
          map.set(
            `user:default/${(entity.metadata.name as string).toLocaleLowerCase()}`,
            entity,
          );
        }
        return map;
      },
      new Map<string, Entity>(),
    );

    return entityMap;
  }
}
