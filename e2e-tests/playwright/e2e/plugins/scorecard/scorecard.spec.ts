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

import { test, expect } from "@playwright/test";
import { mockScorecardResponse } from "../../../utils/scorecard-utils";
import { ComponentImportPage } from "../../../support/page-objects/scorecard/component-import-page";
import { CatalogPage } from "../../../support/page-objects/scorecard/catalog-page";
import { ScorecardPage } from "../../../support/page-objects/scorecard/scorecard-page";
import { setupRBAC } from "../../../utils/rbac-setup";
import {
  CUSTOM_SCORECARD_RESPONSE,
  EMPTY_SCORECARD_RESPONSE,
  UNAVAILABLE_METRIC_RESPONSE,
  INVALID_THRESHOLD_RESPONSE,
} from "../../../utils/scorecard-response-utils";

test.describe.serial("Pre-RBAC Access Tests", () => {
  test("Display access denied message when RBAC is not configured", async ({
    page,
  }) => {
    const catalogPage = new CatalogPage(page);
    await page.goto("/");
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent("Red Hat Developer Hub");
    await page.getByText("Scorecard").click();
    await expect(page.getByText("Missing permission")).toBeVisible();
    await expect(page.getByRole("article")).toContainText(
      "To view Scorecard plugin, contact your administrator to give the scorecard.metric.read permission.",
    );
  });
});

test.describe.serial("Scorecard Plugin Tests", () => {
  let catalogPage: CatalogPage;
  let importPage: ComponentImportPage;
  let scorecardPage: ScorecardPage;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();

    await setupRBAC(page);

    await context.close();
  });

  test.beforeEach(async ({ page }) => {
    catalogPage = new CatalogPage(page);
    importPage = new ComponentImportPage(page);
    scorecardPage = new ScorecardPage(page);
  });

  test("Import component and validate scorecard tabs for GitHub PRs and Jira tickets", async ({
    page,
  }) => {
    await mockScorecardResponse(page, CUSTOM_SCORECARD_RESPONSE);

    await page.goto("/");
    await catalogPage.navigateToCatalog();
    await importPage.startComponentImport();
    await importPage.analyzeComponent(
      "https://github.com/rhdh-pai-qe/backstage-catalog/blob/main/catalog-info.yaml",
    );
    await importPage.viewImportedComponent();
    await scorecardPage.openTab();

    await scorecardPage.verifyScorecardValues({
      "GitHub open PRs": "9",
      "Jira open blocking tickets": "8",
    });

    for (const metric of scorecardPage.scorecardMetrics) {
      await scorecardPage.validateScorecardAriaFor(metric);
    }
  });

  test("Display empty state when scorecard API returns no metrics", async ({
    page,
  }) => {
    await mockScorecardResponse(page, EMPTY_SCORECARD_RESPONSE);

    await page.goto("/");
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent("rhdh-app");
    await scorecardPage.openTab();

    await scorecardPage.expectEmptyState();
  });

  test("Displays error state for unavailable data while rendering metrics", async ({
    page,
  }) => {
    await mockScorecardResponse(page, UNAVAILABLE_METRIC_RESPONSE);

    await page.goto("/");
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent("rhdh-app");
    await scorecardPage.openTab();

    const jiraMetric = scorecardPage.scorecardMetrics[1];
    const githubMetric = scorecardPage.scorecardMetrics[0];

    const isJiraVisible = await scorecardPage.isScorecardVisible(
      jiraMetric.title,
    );
    expect(isJiraVisible).toBe(true);

    const isGithubVisible = await scorecardPage.isScorecardVisible(
      githubMetric.title,
    );
    expect(isGithubVisible).toBe(true);

    const errorLocator = page.getByRole("heading", {
      name: "Metric data unavailable",
    });
    await expect(errorLocator).toBeVisible();

    await errorLocator.hover();
    const errorTooltip = UNAVAILABLE_METRIC_RESPONSE.find(
      (metric) => metric.id === "github.open-prs",
    )?.error;

    expect(errorTooltip).toBeTruthy();
    await expect(page.getByText(errorTooltip!)).toBeVisible();

    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });

  test("Display error state for invalid threshold config while rendering metrics", async ({
    page,
  }) => {
    await mockScorecardResponse(page, INVALID_THRESHOLD_RESPONSE);

    await page.goto("/");
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent("rhdh-app");
    await scorecardPage.openTab();

    const githubMetric = scorecardPage.scorecardMetrics[0];
    const jiraMetric = scorecardPage.scorecardMetrics[1];

    const isGithubVisible = await scorecardPage.isScorecardVisible(
      githubMetric.title,
    );
    expect(isGithubVisible).toBe(true);

    const isJiraVisible = await scorecardPage.isScorecardVisible(
      jiraMetric.title,
    );
    expect(isJiraVisible).toBe(true);

    const errorLocator = page.getByRole("heading", {
      name: "Invalid thresholds",
    });
    await expect(errorLocator).toBeVisible();

    await errorLocator.hover();
    const errorTooltip = INVALID_THRESHOLD_RESPONSE.find(
      (metric) => metric.id === "github.open-prs",
    )?.result?.thresholdResult?.error;

    expect(errorTooltip).toBeTruthy();
    await expect(page.getByText(errorTooltip!)).toBeVisible();

    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });
});
