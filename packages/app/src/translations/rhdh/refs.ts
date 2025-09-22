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

import { createTranslationRef } from '@backstage/core-plugin-api/alpha';

/**
 * Messages object containing all English translations.
 * This is our single source of truth for translations.
 * @public
 */
export const rhdhMessages = {
  menuItem: {
    clusters: 'Clusters',
    rbac: 'RBAC',
    bulkImport: 'Bulk import',
    docs: 'Docs',
    lighthouse: 'Lighthouse',
    techRadar: 'Tech Radar',
    orchestrator: 'Orchestrator',
    adoptionInsights: 'Adoption Insights',
  },
};

/**
 * Translation reference for Quickstart plugin
 * @public
 */
export const rhdhTranslationRef = createTranslationRef({
  id: 'plugin.rhdh',
  messages: rhdhMessages,
});
