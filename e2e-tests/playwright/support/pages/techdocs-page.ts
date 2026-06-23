import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";
import { SidebarPage } from "./sidebar-page";

/** TechDocs navigation and content verification. */
export class TechDocsPage {
  private readonly ui: UIhelper;
  private readonly sidebar: SidebarPage;

  constructor(page: Page) {
    this.ui = new UIhelper(page);
    this.sidebar = new SidebarPage(page);
  }

  async openDocFromFavorites(docName: string): Promise<void> {
    await this.sidebar.openSidebarButton("Favorites");
    await this.sidebar.openSidebar("Docs");
    await this.ui.clickLink(docName);
  }

  async verifyDocHeading(heading: string): Promise<void> {
    await this.ui.verifyHeading(heading);
  }
}
