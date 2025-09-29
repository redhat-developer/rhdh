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

/**
 * Sets up RBAC configuration before tests.
 */
export async function setupRBAC(page: Page) {
  await page.goto("/rbac");
  const enterButton = page.getByRole("button", { name: "Enter" });
  await expect(enterButton).toBeVisible();
  await enterButton.click();
  await page.getByTestId("create-role").click();

  await page.getByRole("textbox", { name: "Name" }).fill("rhdh-testing");
  await page.getByTestId("nextButton-0").click();

  await page.getByRole("combobox", { name: "Select users and groups" }).click();
  await page
    .getByRole("option", { name: "guest", exact: true })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("nextButton-1").click();

  await page.getByRole("combobox", { name: "Select plugins" }).click();
  await page
    .getByRole("option", { name: "Catalog" })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("option", { name: "Scorecard" })
    .getByRole("checkbox")
    .check();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("expand-row-catalog").click();
  await page
    .getByRole("cell", { name: "catalog.entity.read info" })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("cell", { name: "catalog.entity.create" })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("cell", { name: "catalog.location.analyze" })
    .getByRole("checkbox")
    .check();
  await page
    .getByRole("cell", { name: "catalog.location.create" })
    .getByRole("checkbox")
    .check();
  await page.getByTestId("expand-row-catalog").click();

  await page.getByTestId("expand-row-scorecard").click();
  await page
    .getByRole("cell", { name: "scorecard.metric.read info" })
    .getByRole("checkbox")
    .check();
  await page.getByTestId("expand-row-scorecard").click();

  await page.getByTestId("nextButton-2").click();
  await page.getByRole("button", { name: "Create" }).click();

  await page.locator("a").filter({ hasText: "Home" }).click();
  await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
}
