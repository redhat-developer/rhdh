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

  /**
   * Analyzes and imports (or refreshes) a component.
   * Returns true if a fresh import was performed, false if the
   * component already existed and was refreshed.
   */
  async analyzeComponent(url: string): Promise<boolean> {
    await this.uiHelper.fillTextInputByLabel("URL", url);
    await this.uiHelper.clickButton("Analyze");

    // After analysis the wizard shows "Import" for new components or
    // "Refresh" when the component already exists in the catalog.
    const importButton = this.page.getByRole("button", { name: "Import" });
    const refreshButton = this.page.getByRole("button", { name: "Refresh" });
    const resolved = await Promise.race([
      importButton
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => "import" as const),
      refreshButton
        .waitFor({ state: "visible", timeout: 10000 })
        .then(() => "refresh" as const),
    ]);

    if (resolved === "refresh") {
      await refreshButton.click();
      return false;
    }
    await importButton.click();
    await this.page.waitForTimeout(5000);
    return true;
  }

  async viewImportedComponent() {
    await this.uiHelper.clickButton("View Component");
    // After a component is imported, wait for the Overview tab to be visible.
    // This could take sometime more time depending on the environment performance.
    // We saw API calls taking round about 10 seconds in some cases on our CI.
    const tabLocator = this.page.getByRole("tab", { name: "Overview" });
    await tabLocator.waitFor({ state: "visible", timeout: 20000 });
  }
}
