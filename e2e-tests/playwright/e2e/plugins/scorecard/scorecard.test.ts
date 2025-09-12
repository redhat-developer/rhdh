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
import { test } from '@playwright/test';
import { mockScorecardResponse, customScorecardResponse, emptyScorecardResponse } from '../../../utils/scorecard-utils';
import { ComponentImportPage } from '../../../support/page-objects/scorecard/component-import-page';
import { CatalogPage } from '../../../support/page-objects/scorecard/catalog-page';
import { ScorecardPage } from '../../../support/page-objects/scorecard/scorecard-page';

test.describe.serial('Scorecard Plugin Tests', () => {
  let catalogPage: CatalogPage;
  let importPage: ComponentImportPage;
  let scorecardPage: ScorecardPage;

  test.beforeEach(async ({ page }) => {
    catalogPage = new CatalogPage(page);
    importPage = new ComponentImportPage(page);
    scorecardPage = new ScorecardPage(page);
  });

  test('Import component and validate scorecard tabs', async ({ page }) => {
    await page.goto('/');
    await catalogPage.navigateToCatalog();
    await importPage.startComponentImport();
    await importPage.analyzeComponent(
      'https://github.com/rhdh-pai-qe/backstage-catalog/blob/main/catalog-info.yaml',
    );
    await importPage.viewImportedComponent();
    await scorecardPage.openTab();
    await scorecardPage.validateScorecardAria();
  });

  test('Display mocked scorecard metrics for GitHub PRs and Jira tickets', async ({
    page,
  }) => {
    await mockScorecardResponse(page, customScorecardResponse);

    await page.goto('/');
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent('rhdh-app');
    await scorecardPage.openTab();

    await scorecardPage.verifyScorecardValues({
      'Github open PRs': '9',
      'Jira open blocking tickets': '8',
    });
  });

  test('Display empty state when scorecard API returns no metrics', async ({
    page,
  }) => {
    await mockScorecardResponse(page, emptyScorecardResponse);

    await page.goto('/');
    await catalogPage.navigateToCatalog();
    await catalogPage.openComponent('rhdh-app');
    await scorecardPage.openTab();

    await scorecardPage.expectEmptyState();
  });
});
