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

import { Page, expect, Locator } from "@playwright/test";

export class ScorecardPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  get scorecardMetrics() {
    return [
      {
        title: "GitHub open PRs",
        description:
          "Current count of open Pull Requests for a given GitHub repository.",
      },
      {
        title: "Jira open blocking tickets",
        description:
          "Highlights the number of issues that are currently open in Jira.",
      },
    ];
  }

  getScorecardLocator(scorecardTitle: string): Locator {
    return this.page.getByText(scorecardTitle, { exact: true });
  }

  getErrorHeading(errorText: string): Locator {
    return this.page.getByRole("heading", { name: errorText });
  }

  async openTab() {
    const scorecardTab = this.page.getByRole("tab", { name: "Scorecard" });
    await expect(scorecardTab).toBeVisible();
    await scorecardTab.click();
  }

  async expectEmptyState() {
    await expect(this.page.getByText("No scorecards added yet")).toBeVisible();
    await expect(this.page.getByRole("article")).toContainText(
      "Scorecards help you monitor component health at a glance. To begin, explore our documentation for setup guidelines.",
    );
    await expect(
      this.page.getByRole("link", { name: "View documentation" }),
    ).toBeVisible();
  }

  async validateScorecardAriaFor(scorecard: {
    title: string;
    description: string;
  }) {
    const { title, description } = scorecard;

    const scorecardSection = this.page
      .locator("article")
      .filter({ hasText: title });

    await expect(scorecardSection).toMatchAriaSnapshot(`
      - article:
        - text: ${title}
        - paragraph: ${description}
        - paragraph: /Success/
        - paragraph: /Warning/
        - paragraph: /Error/
    `);
  }

  async expectScorecardVisible(scorecardTitle: string) {
    await expect(this.getScorecardLocator(scorecardTitle)).toBeVisible();
  }

  async expectScorecardHidden(scorecardTitle: string) {
    await expect(this.getScorecardLocator(scorecardTitle)).toBeHidden();
  }

  async expectErrorHeading(errorText: string) {
    await expect(this.getErrorHeading(errorText)).toBeVisible();
  }
}
