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
import { Page, expect } from '@playwright/test';

export class CatalogPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async navigateToCatalog() {
    const enterButton = this.page.getByRole('button', { name: 'Enter' });
    await expect(enterButton).toBeVisible();
    await enterButton.click();
    await this.page.getByRole('button', { name: 'Hide' }).click();
    await this.page.getByRole('link', { name: 'Catalog' , exact: true}).click();
    await expect(this.page.getByText('Backstage Catalog')).toBeVisible();
  }

  async openComponent(componentName: string) {
    const link = this.page.getByRole('link', { name: componentName });
    await expect(link).toBeVisible();
    await link.click();
  }
}
