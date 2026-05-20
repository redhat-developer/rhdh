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

import { readBackstageTokenExpiration } from './readBackstageTokenExpiration';

describe('readBackstageTokenExpiration', () => {
  it('returns the default (3600s) when the key is not configured', () => {
    const config = mockServices.rootConfig();
    expect(readBackstageTokenExpiration(config)).toEqual(3600);
  });

  it('returns the configured duration when within the allowed range', () => {
    const config = mockServices.rootConfig({
      data: { auth: { backstageTokenExpiration: { minutes: 30 } } },
    });
    expect(readBackstageTokenExpiration(config)).toEqual(1800);
  });

  it('clamps to the minimum (600s) when the configured value is too low', () => {
    const config = mockServices.rootConfig({
      data: { auth: { backstageTokenExpiration: { seconds: 100 } } },
    });
    expect(readBackstageTokenExpiration(config)).toEqual(600);
  });

  it('clamps to the maximum (86400s) when the configured value is too high', () => {
    const config = mockServices.rootConfig({
      data: { auth: { backstageTokenExpiration: { hours: 48 } } },
    });
    expect(readBackstageTokenExpiration(config)).toEqual(86400);
  });
});
