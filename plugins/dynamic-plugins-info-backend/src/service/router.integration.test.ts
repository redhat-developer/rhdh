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
import {
  DynamicPluginProvider,
  dynamicPluginsServiceRef,
} from '@backstage/backend-dynamic-feature-service';
import { createServiceFactory } from '@backstage/backend-plugin-api';
import {
  mockCredentials,
  mockServices,
  startTestBackend,
} from '@backstage/backend-test-utils';

import request from 'supertest';

import { plugins } from '../../__fixtures__/data';
import { dynamicPluginsInfoPlugin } from '../plugin';

// The plugin resolves its dynamic-plugin source from `dynamicPluginsServiceRef`.
// A stub factory feeds the same fixtures the unit tests use, so the real plugin
// wiring runs end-to-end without a dynamic-plugin runtime.
const mockDynamicPluginsService = createServiceFactory({
  service: dynamicPluginsServiceRef,
  deps: {},
  async factory() {
    return { plugins: () => plugins } as unknown as DynamicPluginProvider;
  },
});

describe('dynamic-plugins-info backend (Layer 2 integration)', () => {
  it('starts the real plugin and serves the loaded-plugins endpoint', async () => {
    const { server } = await startTestBackend({
      features: [
        dynamicPluginsInfoPlugin,
        mockDynamicPluginsService,
        mockServices.rootConfig.factory(),
      ],
    });

    const response = await request(server)
      .get('/api/dynamic-plugins-info/loaded-plugins')
      .set('Authorization', mockCredentials.user.header());

    expect(response.status).toEqual(200);
    expect(response.body.length).toBeGreaterThan(0);
  }, 30_000);
});
