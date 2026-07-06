import { type Locator, type Page } from "@playwright/test";

import { hasJsonHealthcheck } from "../auth/app-shell";
import { LegacySidebarAdapter } from "./legacy-sidebar-adapter";
import { RhdhSidebarAdapter } from "./rhdh-sidebar-adapter";

export interface SidebarAdapter {
  expandSection(sectionLabel: string): Promise<void>;
  openLink(linkName: string): Promise<void>;
  openInSection(sectionLabel: string, linkName: string): Promise<void>;
  expectLinkVisible(linkName: string, sectionLabel?: string): Promise<void>;
  waitForVisible(): Promise<void>;
}

const sidebarNavByPage = new WeakMap<Page, SidebarNav>();

/** Deep sidebar navigation module — adapter chosen once per page session. */
export class SidebarNav {
  private constructor(
    private readonly page: Page,
    private readonly adapter: SidebarAdapter,
  ) {}

  static async forPage(page: Page): Promise<SidebarNav> {
    const cached = sidebarNavByPage.get(page);
    if (cached !== undefined) {
      return cached;
    }

    const adapter = (await hasJsonHealthcheck(page))
      ? new RhdhSidebarAdapter(page)
      : new LegacySidebarAdapter(page);
    const nav = new SidebarNav(page, adapter);
    sidebarNavByPage.set(page, nav);
    return nav;
  }

  getSectionMenuItem(sectionName: string): Locator {
    return this.page.getByTestId("login-button").getByText(sectionName);
  }

  expandSection(sectionLabel: string): Promise<void> {
    return this.adapter.expandSection(sectionLabel);
  }

  openLink(linkName: string): Promise<void> {
    return this.adapter.openLink(linkName);
  }

  openInSection(sectionLabel: string, linkName: string): Promise<void> {
    return this.adapter.openInSection(sectionLabel, linkName);
  }

  expectLinkVisible(linkName: string, sectionLabel?: string): Promise<void> {
    return this.adapter.expectLinkVisible(linkName, sectionLabel);
  }

  waitForVisible(): Promise<void> {
    return this.adapter.waitForVisible();
  }
}
