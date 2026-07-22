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
// and exposes the spies so tests can assert the exact query methods the store
// invokes, keeping failures clear and less sensitive to the promise/method
// interop.
const mockDatabase = (rows: UserInfoRow[], countResult?: { count: number }) => {
  const first = jest.fn().mockResolvedValue(countResult);
  const count = jest.fn().mockReturnValue({ first });
  const query: any = Promise.resolve(rows);
  query.count = count;
  const table = jest.fn().mockReturnValue(query);
  return { db: table as unknown as Knex, table, count, first };
};

const userRow: UserInfoRow = {
  user_entity_ref: 'user:default/jdoe',
  user_info: '{}',
  updated_at: '2026-01-01 12:00:00',
};

describe('DatabaseUserInfoStore', () => {
  it('returns the recorded user rows from the user_info table', async () => {
    const { db, table } = mockDatabase([userRow]);
    const store = new DatabaseUserInfoStore(db);

    await expect(store.getListUsers()).resolves.toEqual([userRow]);
    expect(table).toHaveBeenCalledWith('user_info');
  });

  it('returns the active user count via a count query', async () => {
    const { db, count } = mockDatabase([], { count: 7 });
    const store = new DatabaseUserInfoStore(db);

    await expect(store.getQuantityRecordedActiveUsers()).resolves.toEqual(7);
    expect(count).toHaveBeenCalledWith('user_entity_ref as count');
  });

  it('throws when the count query returns no result', async () => {
    const { db } = mockDatabase([], undefined);
    const store = new DatabaseUserInfoStore(db);

    await expect(store.getQuantityRecordedActiveUsers()).rejects.toThrow(
      'No user info found',
    );
  });
});
