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
import { Knex } from 'knex';

import { DatabaseUserInfoStore, UserInfoRow } from './databaseUserInfoStore';

// Knex query builders are both thenable (resolve to rows) and chainable
// (`.count().first()`). The helper reproduces both shapes from a single call
// so the store can be unit-tested without a real database.
const mockDatabase = (rows: UserInfoRow[], countResult?: { count: number }) => {
  const query: any = Promise.resolve(rows);
  query.count = jest.fn().mockReturnValue({
    first: jest.fn().mockResolvedValue(countResult),
  });
  return jest.fn().mockReturnValue(query) as unknown as Knex;
};

const userRow: UserInfoRow = {
  user_entity_ref: 'user:default/jdoe',
  user_info: '{}',
  updated_at: '2026-01-01 12:00:00',
};

describe('DatabaseUserInfoStore', () => {
  it('returns the recorded user rows', async () => {
    const store = new DatabaseUserInfoStore(mockDatabase([userRow]));

    await expect(store.getListUsers()).resolves.toEqual([userRow]);
  });

  it('returns the active user count', async () => {
    const store = new DatabaseUserInfoStore(mockDatabase([], { count: 7 }));

    await expect(store.getQuantityRecordedActiveUsers()).resolves.toEqual(7);
  });

  it('throws when the count query returns no result', async () => {
    const store = new DatabaseUserInfoStore(mockDatabase([], undefined));

    await expect(store.getQuantityRecordedActiveUsers()).rejects.toThrow(
      'No user info found',
    );
  });
});
