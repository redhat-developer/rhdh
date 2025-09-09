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
import { Page, expect } from '@playwright/test';

export async function waitUntilApiCallSucceeds(
  page: Page,
  urlPart: string = '/api/scorecard/metrics/catalog/Component/default/rhdh-app',
): Promise<void> {
  const response = await page.waitForResponse(
    async res => {
      const urlMatches = res.url().includes(urlPart);
      const isSuccess = res.status() === 200;
      return urlMatches && isSuccess;
    },
    { timeout: 60000 },
  );

  expect(response.status()).toBe(200);
}

const SCORECARD_API_ROUTE =
  '**/api/scorecard/metrics/catalog/Component/default/rhdh-app';

export async function mockScorecardResponse(
  page: Page,
  responseData: object,
  status = 200,
) {
  await page.route(SCORECARD_API_ROUTE, async route => {
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(responseData),
    });
  });
}

export const customScorecardResponse = [
  {
    id: "github.open-prs",
    status: "success",
    metadata: {
      title: "Github open PRs",
      description: "Current count of open Pull Requests for a given GitHub repository.",
      type: "number",
      history: true
    },
    result: {
      value: 9,
      timestamp: "2025-09-08T09:08:55.629Z",
      thresholdResult: {
        definition: {
          rules: [
            { key: "error", expression: ">=200" },
            { key: "warning", expression: "10-200" },
            { key: "success", expression: "<10" }
          ]
        },
        status: "success",
        evaluation: "success"
      }
    }
  },
  {
    id: "jira.open-issues",
    status: "success",
    metadata: {
      title: "Jira open blocking tickets",
      description: "Highlights the number of critical, blocking issues that are currently open in Jira.",
      type: "number",
      history: true
    },
    result: {
      value: 8,
      timestamp: "2025-09-08T09:08:55.629Z",
      thresholdResult: {
        definition: {
          rules: [
            { key: "error", expression: ">=50" },
            { key: "warning", expression: "10-50" },
            { key: "success", expression: "<10" }
          ]
        },
        status: "success",
        evaluation: "success"
      }
    }
  }
];

export const emptyScorecardResponse = [];
