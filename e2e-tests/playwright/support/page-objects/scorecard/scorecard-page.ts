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

import { Page, expect } from "@playwright/test";
import { waitUntilApiCallSucceeds } from "../../../utils/scorecard-utils";

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
          "Highlights the number of critical, blocking issues that are currently open in Jira.",
      },
    ];
  }

  async openTab() {
    const scorecardTab = this.page.getByText("Scorecard");
    await expect(scorecardTab).toBeVisible();
    await Promise.all([
      waitUntilApiCallSucceeds(this.page),
      scorecardTab.click(),
    ]);
  }

  async verifyScorecardValues(expectedValues: { [key: string]: string }) {
    for (const [metric, value] of Object.entries(expectedValues)) {
      await expect(this.page.getByText(metric)).toBeVisible();
      await expect(this.page.getByText(value)).toBeVisible();
    }
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
        - paragraph: /Error/
        - paragraph: /Warning/
        - paragraph: /Success/
    `);
  }

  async isScorecardVisible(scorecardTitle: string): Promise<boolean> {
    try {
      await expect(
        this.page.getByText(scorecardTitle, { exact: true }),
      ).toBeVisible({ timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }
}
