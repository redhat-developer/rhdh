import { expect, type Locator, type Page } from "@playwright/test";

import type { SidebarAdapter } from "./sidebar-nav";

export class RhdhSidebarAdapter implements SidebarAdapter {
  constructor(private readonly page: Page) {}

  private getNav(): Locator {
    return this.page
      .getByRole("navigation")
      .filter({ hasNot: this.page.getByTestId("KeyboardArrowDownOutlinedIcon") })
      .first();
  }

  private sidebarLinks(linkName: string): Locator {
    return this.getNav().getByRole("link", { name: linkName, exact: true });
  }

  private async resolveVisibleLink(linkName: string): Promise<Locator> {
    const candidates = this.sidebarLinks(linkName);
    await expect(candidates.first()).toBeAttached({ timeout: 15_000 });

    const count = await candidates.count();
    for (let index = 0; index < count; index++) {
      const candidate = candidates.nth(index);
      if (await candidate.isVisible()) {
        return candidate;
      }
    }

    throw new Error(`Sidebar link "${linkName}" is not visible`);
  }

  private async expandSectionInternal(sectionLabel: string): Promise<void> {
    const sectionButton = this.getNav().getByRole("button", {
      name: sectionLabel,
      exact: true,
    });
    await expect(sectionButton).toBeVisible();

    const expanded = await sectionButton.getAttribute("aria-expanded");
    if (expanded === "true") {
      return;
    }
    if (expanded === "false") {
      await sectionButton.click();
      await expect(sectionButton).toHaveAttribute("aria-expanded", "true");
      return;
    }

    const sectionGroup = sectionButton.locator("xpath=..");
    const nestedLinks = sectionGroup.getByRole("link");
    if ((await nestedLinks.count()) > 0 && (await nestedLinks.first().isVisible())) {
      return;
    }
    await sectionButton.click();
  }

  private async collapseOtherSections(keepSection: string): Promise<void> {
    const nav = this.getNav();
    const keepButton = nav.getByRole("button", { name: keepSection, exact: true });
    const keepHandle = await keepButton.elementHandle();
    const buttons = nav.getByRole("button");
    const count = await buttons.count();
    for (let index = 0; index < count; index++) {
      const button = buttons.nth(index);
      if ((await button.getAttribute("aria-expanded")) !== "true") {
        continue;
      }
      if (keepHandle !== null && (await button.evaluate((el, keep) => el === keep, keepHandle))) {
        continue;
      }
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "false");
    }
  }

  private async activateLink(resolveLink: () => Promise<Locator>): Promise<void> {
    try {
      await expect(async () => {
        const link = await resolveLink();
        await link.scrollIntoViewIfNeeded();
        await expect(link).toBeEnabled();
        await link.click({ timeout: 3000 });
      }).toPass({
        intervals: [500],
        timeout: 15_000,
      });
    } catch {
      const link = await resolveLink();
      const href = await link.getAttribute("href");
      if (href !== null && href !== "") {
        await this.page.goto(href);
        return;
      }
      throw new Error("Sidebar link is not clickable and has no href fallback");
    }
  }

  async expandSection(sectionLabel: string): Promise<void> {
    await this.expandSectionInternal(sectionLabel);
  }

  async openLink(linkName: string): Promise<void> {
    await this.activateLink(() => this.resolveVisibleLink(linkName));
  }

  async expectLinkVisible(linkName: string, sectionLabel?: string): Promise<void> {
    if (sectionLabel !== undefined && sectionLabel !== "") {
      await this.expandSectionInternal(sectionLabel);
    }
    const link = await this.resolveVisibleLink(linkName);
    await expect(link).toBeVisible();
  }

  async openInSection(sectionLabel: string, linkName: string): Promise<void> {
    await this.collapseOtherSections(sectionLabel);
    await this.expandSectionInternal(sectionLabel);
    await this.activateLink(async () => {
      const sectionButton = this.getNav().getByRole("button", {
        name: sectionLabel,
        exact: true,
      });
      const scopedLink = sectionButton
        .locator("xpath=..")
        .getByRole("link", { name: linkName, exact: true });
      if ((await scopedLink.count()) > 0 && (await scopedLink.first().isVisible())) {
        return scopedLink.first();
      }
      return this.resolveVisibleLink(linkName);
    });
  }

  async waitForVisible(): Promise<void> {
    await expect(this.getNav().getByRole("link").first()).toBeVisible({
      timeout: 10_000,
    });
  }
}
