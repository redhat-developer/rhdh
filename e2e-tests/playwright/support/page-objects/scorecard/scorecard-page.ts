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
import { waitUntilApiCallSucceeds } from '../../../utils/scorecard-utils';

export class ScorecardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async openTab() {
    const tab = this.page.getByText('Scorecard');
    await expect(tab).toBeVisible();
    await tab.click();
    await waitUntilApiCallSucceeds(this.page);
  }

  async verifyScorecardValues(expectedValues: { [key: string]: string }) {
    for (const [metric, value] of Object.entries(expectedValues)) {
      await expect(this.page.getByText(metric)).toBeVisible();
      await expect(this.page.getByText(value)).toBeVisible();
    }
  }

  async expectEmptyState() {
    await expect(this.page.getByText('No scorecards added yet')).toBeVisible();
  }

  async validateScorecardAria() {
    await expect(this.page.getByRole('article')).toMatchAriaSnapshot(`
      - heading "Github open PRs" [level=6]
      - paragraph: Current count of open Pull Requests for a given GitHub repository.
      - paragraph: /error/
      - paragraph: /warning/
      - paragraph: /success/
    `);
    await expect(this.page.getByRole('article')).toMatchAriaSnapshot(`
      - heading "Jira open blocking tickets" [level=6]
      - paragraph: Highlights the number of critical, blocking issues that are currently open in Jira.
      - paragraph: /error/
      - paragraph: /warning/
      - paragraph: /success/
    `);
  }
}
