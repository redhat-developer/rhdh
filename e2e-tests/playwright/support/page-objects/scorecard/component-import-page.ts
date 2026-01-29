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
import { Page } from "@playwright/test";
import { UIhelper } from "../../../utils/ui-helper";
import { Catalog } from "../../../support/pages/catalog";
import { ScorecardPage } from "./scorecard-page";

export class ComponentImportPage {
  readonly page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async startComponentImport() {
    await this.uiHelper.clickButton("Self-service");
    await this.uiHelper.clickButton("Import an existing Git repository");
  }

  async analyzeComponent(url: string) {
    await this.uiHelper.fillTextInputByLabel("URL", url);
    await this.uiHelper.clickButton("Analyze");
    await this.uiHelper.clickButton("Import");
    await this.page.waitForTimeout(5000);
  }

  async viewImportedComponent() {
    await this.uiHelper.clickButton("View Component");
    const entityNotFoundLocator = this.page.getByRole("button", {
      name: "Warning: Entity not found",
    });
    if (await entityNotFoundLocator.isVisible({ timeout: 10000 })) {
      await this.page.reload();
    }
    // After a component is imported, wait for the Overview tab to be visible
    // This could take sometime more time depending on the environment performance.
    // We saw API calls taking round about 10 seconds in some cases on our CI.
    const tabLocator = this.page.getByRole("tab", { name: "Overview" });
    await tabLocator.waitFor({ state: "visible", timeout: 20000 });
  }

  async importAndOpenScorecard(
    url: string,
    catalog: Catalog,
    scorecardPage: ScorecardPage,
  ) {
    await catalog.go();
    await this.startComponentImport();
    await this.analyzeComponent(url);
    await this.viewImportedComponent();
    await scorecardPage.openTab();
  }
}
