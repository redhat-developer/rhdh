import { Page } from "@playwright/test";

import * as interaction from "../../utils/ui-helper/interaction";
import * as verification from "../../utils/ui-helper/verification";
import { SidebarPage } from "./sidebar-page";

/** TechDocs navigation and content verification. */
export class TechDocsPage {
  private readonly sidebar: SidebarPage;

  constructor(private readonly page: Page) {
    this.sidebar = new SidebarPage(page);
  }

  async openDocFromFavorites(docName: string): Promise<void> {
    await this.sidebar.openSidebarButton("Favorites");
    await this.sidebar.openSidebar("Docs");
    await interaction.clickLink(this.page, docName);
  }

  async verifyDocHeading(heading: string): Promise<void> {
    await verification.verifyHeading(this.page, heading);
  }
}
