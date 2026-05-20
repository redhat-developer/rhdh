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
import { mockServices, startTestBackend } from '@backstage/backend-test-utils';

import request from 'supertest';

import { licensedUsersInfoPlugin } from '../plugin';

// The plugin reads `backend.database` directly via DatabaseManager.fromConfig
// and disables itself for a pure in-memory SQLite database. A SQLite database
// with an explicit (in-memory) directory keeps the plugin enabled while staying
// cluster-free — this is the real backend wiring, no mocks of the plugin itself.
const sqliteConfig = mockServices.rootConfig.factory({
  data: {
    backend: {
      database: {
        client: 'better-sqlite3',
        connection: { directory: ':memory:' },
      },
    },
  },
});

// Pure in-memory SQLite (no `directory`) trips the plugin's self-disable check.
const inMemoryConfig = mockServices.rootConfig.factory({
  data: {
    backend: {
      database: {
        client: 'better-sqlite3',
        connection: ':memory:',
      },
    },
  },
});

describe('licensed-users-info backend (Layer 2 integration)', () => {
  it('starts the real plugin and serves the health endpoint', async () => {
    const { server } = await startTestBackend({
      features: [licensedUsersInfoPlugin, sqliteConfig],
    });

    const response = await request(server).get(
      '/api/licensed-users-info/health',
    );

    expect(response.status).toEqual(200);
    expect(response.body).toEqual({ status: 'ok' });
  }, 30_000);

  it('disables all routes under a pure in-memory SQLite database', async () => {
    const { server } = await startTestBackend({
      features: [licensedUsersInfoPlugin, inMemoryConfig],
    });

    const response = await request(server).get(
      '/api/licensed-users-info/health',
    );

    expect(response.status).toEqual(404);
  }, 30_000);
});
