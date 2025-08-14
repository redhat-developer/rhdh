import { expect, Page } from "@playwright/test";
import { GITHUB_URL } from "../../utils/constants";

export class CatalogItem {
  private page: Page;

  githubLink = (path: string): string => {
    return `a[href*="${GITHUB_URL}${path}"]`;
  };

  constructor(page: Page) {
    this.page = page;
  }

  async validateGithubLink(s: string) {
    const url = this.githubLink(s);
    const link = this.page.locator(url).first();
    await expect(link).toBeVisible();
  }
}
