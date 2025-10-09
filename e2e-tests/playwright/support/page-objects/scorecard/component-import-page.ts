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

  async analyzeComponent(url: string) {
    await this.uiHelper.fillTextInputByLabel("URL", url);
    await this.uiHelper.clickButton("Analyze");
    await this.uiHelper.clickButton("Import");
    //wait for few seconds
    await this.page.waitForTimeout(5000);
  }

  async viewImportedComponent() {
    await this.uiHelper.clickButton("View Component");
    await this.uiHelper.verifyText("Overview");
  }
}
