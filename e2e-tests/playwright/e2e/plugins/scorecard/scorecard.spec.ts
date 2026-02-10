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
// Temporarily commented - will re-enable after scorecard delay fix
// import { CatalogImport } from "../../../support/pages/catalog-import";
import { ScorecardPage } from "../../../support/page-objects/scorecard/scorecard-page";
import type { BrowserContext, Page } from "@playwright/test";

test.describe.serial("Scorecard Plugin Tests", () => {
  let context: BrowserContext;
  let page: Page;
  let catalog: Catalog;
  // Temporarily commented - will re-enable after scorecard delay fix
  // let catalogImport: CatalogImport;
  let scorecardPage: ScorecardPage;

  let initialGithubCount: number;
  let initialJiraCount: number;

  test.beforeAll(async ({ browser }, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "scorecard",
    });

    context = await browser.newContext();
    page = await context.newPage();
    catalog = new Catalog(page);
    // Temporarily commented - will re-enable after scorecard delay fix
    // catalogImport = new CatalogImport(page);
    scorecardPage = new ScorecardPage(page);
    await new Common(page).loginAsKeycloakUser();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("Setup aggregated scorecards on homepage", async () => {
    await scorecardPage.navigateToHome();

    await scorecardPage.openAddWidgetDialog();
    await scorecardPage.selectWidget("GitHub open PRs");
    await scorecardPage.enterEditMode();
    await scorecardPage.openAddWidgetDialog();
    await scorecardPage.selectWidget("Jira open blocking tickets");
    await scorecardPage.saveChanges();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectAggregatedScorecardVisible(githubMetric.title);
    await scorecardPage.expectAggregatedScorecardVisible(jiraMetric.title);

    initialGithubCount = await scorecardPage.getAggregatedScorecardEntityCount(
      githubMetric.title,
    );
    initialJiraCount = await scorecardPage.getAggregatedScorecardEntityCount(
      jiraMetric.title,
    );
  });

  test.describe("Entity Scorecards", () => {
    // Temporarily skipped - will re-enable after scorecard delay fix
    // test.beforeAll(async () => {
    //   const addonTestUrl =
    //     "https://github.com/janus-qe/RHDH-scorecard-plugin-test/blob/main/addon-test.yaml";

    //   await catalog.go();
    //   await page.getByRole("button", { name: "Self-service" }).click();
    //   await scorecardPage.uiHelper.clickButton(
    //     "Import an existing Git repository",
    //   );
    //   await catalogImport.registerExistingComponent(addonTestUrl);
    // });

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
    //Temporarily skipped due to scorecard visibility delay; will re-enable after fix.
    test.skip("Validate scorecards on imported addon-test entity", async () => {
      await catalog.go();
      await catalog.goToByName("addon-test");
      await scorecardPage.openTab();

      const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

      await scorecardPage.expectScorecardVisible(githubMetric.title);
      await scorecardPage.expectScorecardVisible(jiraMetric.title);
    });
  });

  //Temporarily skipped due to scorecard visibility delay; will re-enable after fix.
  test.skip("Verify aggregated scorecard counts increased after import", async () => {
    await scorecardPage.navigateToHome();

    const [githubMetric, jiraMetric] = scorecardPage.scorecardMetrics;

    await scorecardPage.expectAggregatedScorecardEntityCountToBe(
      githubMetric.title,
      initialGithubCount + 1,
    );
    await scorecardPage.expectAggregatedScorecardEntityCountToBe(
      jiraMetric.title,
      initialJiraCount + 1,
    );
  });
});
