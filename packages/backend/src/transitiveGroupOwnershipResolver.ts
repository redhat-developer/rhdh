import { AuthService, DiscoveryService } from '@backstage/backend-plugin-api';
import { CatalogApi, CatalogClient } from '@backstage/catalog-client';
import {
  Entity,
  GroupEntity,
  RELATION_CHILD_OF,
  RELATION_MEMBER_OF,
  stringifyEntityRef,
} from '@backstage/catalog-model';
import { Config } from '@backstage/config';
import { AuthOwnershipResolver } from '@backstage/plugin-auth-node';

export class TransitiveGroupOwnershipResolver implements AuthOwnershipResolver {
  private readonly catalogApi: CatalogApi;
  private readonly config: Config;
  private readonly auth: AuthService;

  constructor(deps: {
    discovery: DiscoveryService;
    config: Config;
    auth: AuthService;
    catalog?: CatalogApi;
  }) {
    this.catalogApi = deps.catalog
      ? deps.catalog
      : new CatalogClient({ discoveryApi: deps.discovery });
    this.config = deps.config;
    this.auth = deps.auth;
  }

  private async resolveParentGroups(
    groupRefs: string[],
    processedGroups: Set<string> = new Set(),
  ): Promise<string[]> {
    const allTransitiveGroupRefs = new Set<string>();

    for (const groupRef of groupRefs) {
      if (processedGroups.has(groupRef)) continue;
      processedGroups.add(groupRef);

      if (allTransitiveGroupRefs.has(groupRef)) continue;

      allTransitiveGroupRefs.add(groupRef);

      const { token } = await this.auth.getPluginRequestToken({
        onBehalfOf: await this.auth.getOwnServiceCredentials(),
        targetPluginId: 'catalog',
      });

      const res = await this.catalogApi.getEntitiesByRefs(
        {
          entityRefs: [groupRef],
          fields: ['kind', 'relations'],
        },
        { token },
      );

      const groupEntity = res.items?.find(
        e => e?.kind.toLocaleLowerCase('en-US') === 'group',
      ) as GroupEntity | undefined;

      if (!groupEntity) continue;

      const parentGroupRefs =
        groupEntity.relations
          ?.filter(relation => relation.type === RELATION_CHILD_OF)
          .map(relation => relation.targetRef) || [];

      const parentGroups = await this.resolveParentGroups(
        parentGroupRefs,
        processedGroups,
      );
      parentGroups.forEach(parentGroup =>
        allTransitiveGroupRefs.add(parentGroup),
      );
    }

    return Array.from(allTransitiveGroupRefs);
  }

  /**
   * Returns the user’s own entity reference and direct group memberships.
   * Includes nested group hierarchies if the `includeTransitiveGroupOwnership` config is enabled.
   *
   * @param entity user entity to resolve ownership references for
   *
   * @returns object containing the ownership entity references for the given user entity
   */
  async resolveOwnershipEntityRefs(
    entity: Entity,
  ): Promise<{ ownershipEntityRefs: string[] }> {
    let membershipRefs =
      entity.relations
        ?.filter(
          r =>
            r.type === RELATION_MEMBER_OF && r.targetRef.startsWith('group:'),
        )
        .map(r => r.targetRef) ?? [];

    const includeTransitiveGroupOwnership =
      this.config.getOptionalBoolean('includeTransitiveGroupOwnership') ||
      false;
    if (includeTransitiveGroupOwnership) {
      membershipRefs = await this.resolveParentGroups(membershipRefs);
    }
    return {
      ownershipEntityRefs: Array.from(
        new Set([stringifyEntityRef(entity), ...membershipRefs]),
      ),
    };
  }
}
