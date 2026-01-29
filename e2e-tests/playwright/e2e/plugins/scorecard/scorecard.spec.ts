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
import { Common } from "../../../utils/common";
import { ComponentImportPage } from "../../../support/page-objects/scorecard/component-import-page";
import { Catalog } from "../../../support/pages/catalog";
import { ScorecardPage } from "../../../support/page-objects/scorecard/scorecard-page";

test.describe.serial("Scorecard Plugin Tests", () => {
  let context;
  let page;
  let catalog: Catalog;
  let importPage: ComponentImportPage;
  let scorecardPage: ScorecardPage;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "scorecard",
    });

    context = await browser.newContext();
    page = await context.newPage();
    catalog = new Catalog(page);
    importPage = new ComponentImportPage(page);
    scorecardPage = new ScorecardPage(page);
    await new Common(page).loginAsKeycloakUser();

    // Import the component here instead of the first tests so that they can re-run.
    // It would be great if this would detect if the component is already imported.
    await catalog.go();
    await importPage.startComponentImport();
    await importPage.analyzeComponent(
      "https://github.com/rhdh-pai-qe/backstage-catalog/blob/main/catalog-info.yaml",
    );
    await importPage.viewImportedComponent();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("Import component and validate scorecard tabs for GitHub PRs and Jira tickets", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/all-scorecards.yaml",
      catalog,
      scorecardPage,
    );

    for (const metric of scorecardPage.scorecardMetrics) {
      await scorecardPage.validateScorecardAriaFor(metric);
    }
  });

  test("Validate empty scorecard state", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/no-scorecards.yaml",
      catalog,
      scorecardPage,
    );

    await scorecardPage.expectEmptyState();
  });

  test("Displays error state for unavailable data while rendering metrics", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/metrics-unavailable.yaml",
      catalog,
      scorecardPage,
    );

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
    const errorTooltip =
      "GraphqlResponseError: Request failed due to following response errors: - Could not resolve to a Repository with the name 'dzemanov/react-app-t1'.";
    await expect(page.getByText(errorTooltip)).toBeVisible();

    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });

  test("Display error state for invalid threshold config while rendering metrics", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/invalid-threshold.yaml",
      catalog,
      scorecardPage,
    );

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
    const errorTooltip =
      "ThresholdConfigFormatError: Invalid threshold annotation 'scorecard.io/github.open_prs.thresholds.rules.error: >50d' in entity 'component:default/invalid-threshold': Cannot parse \"50d\" as number from expression: \">50d\"";
    await expect(page.getByText(errorTooltip)).toBeVisible();

    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });

  test("Validate only GitHub scorecard is displayed", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/github-scorecard-only.yaml",
      catalog,
      scorecardPage,
    );

    const githubMetric = scorecardPage.scorecardMetrics[0];
    const jiraMetric = scorecardPage.scorecardMetrics[1];

    const isGithubVisible = await scorecardPage.isScorecardVisible(
      githubMetric.title,
    );
    expect(isGithubVisible).toBe(true);

    const isJiraVisible = await scorecardPage.isScorecardVisible(
      jiraMetric.title,
    );
    expect(isJiraVisible).toBe(false);

    await scorecardPage.validateScorecardAriaFor(githubMetric);
  });

  test("Validate only Jira scorecard is displayed", async () => {
    await importPage.importAndOpenScorecard(
      "https://github.com/rhdh-pai-qe/RHDH-scorecard-plugin-test/blob/main/jira-scorecard-only.yaml",
      catalog,
      scorecardPage,
    );

    const githubMetric = scorecardPage.scorecardMetrics[0];
    const jiraMetric = scorecardPage.scorecardMetrics[1];

    const isGithubVisible = await scorecardPage.isScorecardVisible(
      githubMetric.title,
    );
    expect(isGithubVisible).toBe(false);

    const isJiraVisible = await scorecardPage.isScorecardVisible(
      jiraMetric.title,
    );
    expect(isJiraVisible).toBe(true);

    await scorecardPage.validateScorecardAriaFor(jiraMetric);
  });
});
