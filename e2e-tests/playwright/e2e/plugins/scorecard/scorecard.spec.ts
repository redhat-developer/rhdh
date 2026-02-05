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

import { test } from "@playwright/test";
import { Common } from "../../../utils/common";
import { Catalog } from "../../../support/pages/catalog";
import { ScorecardPage } from "../../../support/page-objects/scorecard/scorecard-page";
import type { BrowserContext, Page } from "@playwright/test";

test.describe.serial("Scorecard Plugin Tests", () => {
  let context: BrowserContext;
  let page: Page;
  let catalog: Catalog;
  let scorecardPage: ScorecardPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "scorecard",
    });

    context = await browser.newContext();
    page = await context.newPage();
    catalog = new Catalog(page);
    scorecardPage = new ScorecardPage(page);
    await new Common(page).loginAsKeycloakUser();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("Validate scorecard tabs for GitHub PRs and Jira tickets", async () => {
    await catalog.go();
    await catalog.goToByName("all-scorecards");
    await scorecardPage.openTab();

    for (const metric of scorecardPage.scorecardMetrics) {
      await scorecardPage.validateScorecardAriaFor(metric);
    }
  });

  test("Validate empty scorecard state", async () => {
    await catalog.go();
    await catalog.goToByName("no-scorecards");
    await scorecardPage.openTab();
    await scorecardPage.expectEmptyState();
  });

  test("Displays error state for unavailable data while rendering metrics", async () => {
    await catalog.go();
    await catalog.goToByName("unavailable-metric-service");
    await scorecardPage.openTab();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectScorecardVisible(githubMetric.title);
    await scorecardPage.expectScorecardVisible(jiraMetric.title);
    await scorecardPage.expectErrorHeading("Metric data unavailable");
    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });

  test("Validate only GitHub scorecard is displayed", async () => {
    await catalog.go();
    await catalog.goToByName("github-scorecard-only");
    await scorecardPage.openTab();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectScorecardVisible(githubMetric.title);
    await scorecardPage.expectScorecardHidden(jiraMetric.title);
    await scorecardPage.validateScorecardAriaFor(githubMetric);
  });

  test("Validate only Jira scorecard is displayed", async () => {
    await catalog.go();
    await catalog.goToByName("jira-scorecard-only");
    await scorecardPage.openTab();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectScorecardHidden(githubMetric.title);
    await scorecardPage.expectScorecardVisible(jiraMetric.title);
    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });

  test("Display error state for invalid threshold config while rendering metrics", async () => {
    await catalog.go();
    await catalog.goToByName("invalid-threshold");
    await scorecardPage.openTab();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectScorecardVisible(githubMetric.title);
    await scorecardPage.expectScorecardVisible(jiraMetric.title);
    await scorecardPage.expectErrorHeading("Invalid thresholds");
    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });
});
