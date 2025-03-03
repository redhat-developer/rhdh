import { mockServices } from '@backstage/backend-test-utils';
import {
  GroupEntity,
  RELATION_CHILD_OF,
  RELATION_MEMBER_OF,
  UserEntity,
} from '@backstage/catalog-model';
import { catalogServiceMock } from '@backstage/plugin-catalog-node/testUtils';

import { TransitiveGroupOwnershipResolver } from './transitiveGroupOwnershipResolver';

describe('resolveParentGroups', () => {
  const mockUser: UserEntity = {
    apiVersion: 'backstage.io/v1beta1',
    kind: 'User',
    metadata: {
      name: 'test-user',
    },
    spec: {},
    relations: [
      {
        type: RELATION_MEMBER_OF,
        targetRef: 'group:default/child-group',
      },
    ],
  };

  const mockGroups: Array<GroupEntity> = [
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Group',
      metadata: { name: 'child-group', namespace: 'default' },
      spec: {
        type: 'group',
        children: [],
      },
      relations: [
        {
          type: RELATION_CHILD_OF,
          targetRef: 'group:default/parent-group',
        },
      ],
    },
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Group',
      metadata: { name: 'parent-group', namespace: 'default' },
      spec: {
        type: 'group',
        children: [],
      },
      relations: [
        {
          type: RELATION_CHILD_OF,
          targetRef: 'group:default/root-group',
        },
      ],
    },
    {
      apiVersion: 'backstage.io/v1alpha1',
      kind: 'Group',
      metadata: { name: 'root-group', namespace: 'default' },
      spec: {
        type: 'group',
        children: [],
      },
    },
  ];

  const config = mockServices.rootConfig({
    data: { includeTransitiveGroupOwnership: true },
  });

  it('should resolve parent groups recursively', async () => {
    const catalogApi = catalogServiceMock({ entities: mockGroups });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });
    const parentGroups = await resolver.resolveOwnershipEntityRefs(mockUser);

    expect(parentGroups).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/child-group',
        'group:default/parent-group',
        'group:default/root-group',
      ],
    });
  });

  it('should handle groups without parents', async () => {
    const mockGroupsWithoutParent: Array<GroupEntity> = [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'child-group', namespace: 'default' },
        spec: {
          type: 'group',
          children: [],
        },
        relations: [],
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'parent-group', namespace: 'default' },
        spec: {
          type: 'group',
          children: [],
        },
      },
    ];
    const catalogApi = catalogServiceMock({
      entities: mockGroupsWithoutParent,
    });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });
    const parentGroups = await resolver.resolveOwnershipEntityRefs(mockUser);

    expect(parentGroups).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/child-group',
      ],
    });
  });

  it('should handle user belonging in multiple groups', async () => {
    const mockGroupsMultipleGroups: Array<GroupEntity> = [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'child-group', namespace: 'default' },
        spec: {
          type: 'group',
          children: [],
        },
        relations: [
          {
            type: RELATION_CHILD_OF,
            targetRef: 'group:default/parent-group',
          },
        ],
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'parent-group', namespace: 'default' },
        spec: {
          type: 'group',
          children: [],
        },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'other-group', namespace: 'default' },
        spec: {
          type: 'group',
          children: [],
        },
      },
    ];
    const catalogApi = catalogServiceMock({
      entities: mockGroupsMultipleGroups,
    });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });
    const mockUserInMultipleGroups: UserEntity = {
      apiVersion: 'backstage.io/v1beta1',
      kind: 'User',
      metadata: {
        name: 'test-user',
      },
      spec: {},
      relations: [
        {
          type: RELATION_MEMBER_OF,
          targetRef: 'group:default/child-group',
        },
        {
          type: RELATION_MEMBER_OF,
          targetRef: 'group:default/other-group',
        },
      ],
    };
    const parentGroups = await resolver.resolveOwnershipEntityRefs(
      mockUserInMultipleGroups,
    );

    expect(parentGroups).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/child-group',
        'group:default/parent-group',
        'group:default/other-group',
      ],
    });
  });

  it('should not resolve parent groups recursively by default (with includeTransitiveGroupOwnership to false)', async () => {
    const catalogApi = catalogServiceMock({ entities: mockGroups });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: mockServices.rootConfig(),
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });
    const parentGroups = await resolver.resolveOwnershipEntityRefs(mockUser);

    expect(parentGroups).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/child-group',
      ],
    });
  });

  it('should handle an user with no group membership', async () => {
    const catalogApi = catalogServiceMock({ entities: [] });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });

    const mockUserNoGroup: UserEntity = {
      apiVersion: 'backstage.io/v1beta1',
      kind: 'User',
      metadata: { name: 'user' },
      spec: {},
      relations: [],
    };

    const result = await resolver.resolveOwnershipEntityRefs(mockUserNoGroup);

    expect(result).toEqual({ ownershipEntityRefs: ['user:default/user'] });
  });

  it('should resolve group memberships with different namespaces', async () => {
    const mockGroupsWithDifferentNamespace: Array<GroupEntity> = [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'group-a', namespace: 'default' },
        spec: { type: 'group', children: [] },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'group-b', namespace: 'other-namespace' },
        spec: { type: 'group', children: [] },
        relations: [
          {
            type: RELATION_CHILD_OF,
            targetRef: 'group:other-namespace/group-b-parent',
          },
        ],
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'group-b-parent', namespace: 'other-namespace' },
        spec: { type: 'group', children: [''] },
      },
    ];

    const catalogApi = catalogServiceMock({
      entities: mockGroupsWithDifferentNamespace,
    });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });

    const mockUserInMultipleNamespace: UserEntity = {
      apiVersion: 'backstage.io/v1beta1',
      kind: 'User',
      metadata: { name: 'test-user' },
      spec: {},
      relations: [
        { type: RELATION_MEMBER_OF, targetRef: 'group:default/group-a' },
        {
          type: RELATION_MEMBER_OF,
          targetRef: 'group:other-namespace/group-b',
        },
      ],
    };

    const result = await resolver.resolveOwnershipEntityRefs(
      mockUserInMultipleNamespace,
    );

    expect(result).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/group-a',
        'group:other-namespace/group-b',
        'group:other-namespace/group-b-parent',
      ],
    });
  });

  it('should handle user with cyclic group memberships', async () => {
    const mockCyclicGroups: Array<GroupEntity> = [
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'child-group', namespace: 'default' },
        spec: { type: 'group', children: [] },
        relations: [
          {
            type: RELATION_CHILD_OF,
            targetRef: 'group:default/parent-group',
          },
        ],
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'parent-group', namespace: 'default' },
        spec: { type: 'group', children: [] },
        relations: [
          {
            type: RELATION_CHILD_OF,
            targetRef: 'group:default/child-group',
          },
        ],
      },
    ];

    const catalogApi = catalogServiceMock({
      entities: mockCyclicGroups,
    });
    const resolver = new TransitiveGroupOwnershipResolver({
      discovery: mockServices.discovery(),
      config: config,
      auth: mockServices.auth.mock({
        getPluginRequestToken: async () => ({ token: 'test-token' }),
      }),
      catalog: catalogApi,
    });

    const result = await resolver.resolveOwnershipEntityRefs(mockUser);

    expect(result).toEqual({
      ownershipEntityRefs: [
        'user:default/test-user',
        'group:default/child-group',
        'group:default/parent-group',
      ],
    });
  });
});
