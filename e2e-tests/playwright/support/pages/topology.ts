import { Page } from "@playwright/test";

export class Topology {
  private page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async hoverOnPodStatusIndicator() {
    await this.page
      .locator('[data-test-id="topology-test"]')
      .getByText("Pod")
      .first()
      .hover({});
  }
}
