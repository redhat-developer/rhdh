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
import { mockServices } from '@backstage/backend-test-utils';
import { CatalogClient } from '@backstage/catalog-client';
import { Entity } from '@backstage/catalog-model';

import { CatalogEntityStore } from './catalogStore';

const buildStore = (items: Entity[]) => {
  const getEntities = jest.fn().mockResolvedValue({ items });
  const catalogClient = { getEntities } as unknown as CatalogClient;
  const store = new CatalogEntityStore(catalogClient, mockServices.auth());
  return { store, getEntities };
};

describe('CatalogEntityStore', () => {
  it('keys User entities by a lowercased default-namespace reference', async () => {
    const { store } = buildStore([
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: { name: 'JDoe' },
        spec: { profile: { displayName: 'John Doe' } },
      },
    ]);

    const entityMap = await store.getUserEntities();

    expect(entityMap.size).toEqual(1);
    expect(entityMap.get('user:default/jdoe')).toMatchObject({
      metadata: { name: 'JDoe' },
    });
  });

  it('ignores non-User kinds and entities without a name', async () => {
    const { store } = buildStore([
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'Group',
        metadata: { name: 'team-a' },
      },
      {
        apiVersion: 'backstage.io/v1alpha1',
        kind: 'User',
        metadata: {} as Entity['metadata'],
      },
    ]);

    const entityMap = await store.getUserEntities();

    expect(entityMap.size).toEqual(0);
  });

  it('queries the catalog for User entities with an on-behalf-of token', async () => {
    const { store, getEntities } = buildStore([]);

    await store.getUserEntities();

    expect(getEntities).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { kind: 'User' } }),
      expect.objectContaining({ token: expect.any(String) }),
    );
  });
});
