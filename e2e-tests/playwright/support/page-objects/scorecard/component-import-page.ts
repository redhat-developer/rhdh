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

export class ComponentImportPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async startComponentImport() {
    await this.page.getByRole("button", { name: "Create" }).click();
    await this.page
      .getByRole("button", { name: "Register Existing Component" })
      .click();
  }

  async analyzeComponent(url: string) {
    await this.page.getByRole("textbox", { name: "URL" }).fill(url);
    await this.page.getByRole("button", { name: "Analyze" }).click();
    await this.page.getByRole("button", { name: "Import" }).click();
    await this.page.waitForTimeout(2000);
  }

  async viewImportedComponent() {
    await this.page.getByRole("button", { name: "View Component" }).click();
    await this.page.getByText("Overview").waitFor();
  }
}
