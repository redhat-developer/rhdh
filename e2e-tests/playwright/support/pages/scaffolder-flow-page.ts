import { expect, Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

export type ReactAppTemplateDetails = {
  componentName: string;
  description: string;
  owner: string;
  label: string;
  annotation: string;
  repoOwner: string;
  repo: string;
};

/** Scaffolder and self-service template flows. */
export class ScaffolderFlowPage {
  private readonly page: Page;
  private readonly ui: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.ui = new UIhelper(page);
  }

  async openImportGitRepository(): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.clickButton("Self-service");
    await this.ui.clickButton("Import an existing Git repository");
  }

  async openSelfServiceFromCatalog(): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.clickButton("Self-service");
  }

  async verifySelfServiceHeading(): Promise<void> {
    await this.ui.verifyHeading("Self-service");
  }

  async clickImportGitRepository(): Promise<void> {
    await this.ui.clickButton("Import an existing Git repository");
  }

  async runCreateReactAppTemplate(
    details: ReactAppTemplateDetails,
  ): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.clickButton("Self-service");
    await this.ui.verifyHeading("Self-service");
    await this.ui.searchInputPlaceholder("Create React App Template");
    await this.ui.verifyText("Create React App Template");
    await this.ui.waitForTextDisappear("Add ArgoCD to an existing project");
    await this.ui.clickButton("Choose");

    await this.ui.fillTextInputByLabel("Name", details.componentName);
    await this.ui.fillTextInputByLabel("Description", details.description);
    await this.ui.fillTextInputByLabel("Owner", details.owner);
    await this.ui.fillTextInputByLabel("Label", details.label);
    await this.ui.fillTextInputByLabel("Annotation", details.annotation);
    await this.ui.clickButton("Next");

    await this.ui.fillTextInputByLabel("Owner", details.repoOwner);
    await this.ui.fillTextInputByLabel("Repository", details.repo);
    await this.ui.pressTab();
    await this.ui.clickButton("Review");
  }

  async fillCreateReactAppTemplateForm(
    details: ReactAppTemplateDetails,
  ): Promise<void> {
    await this.ui.searchInputPlaceholder("Create React App Template");
    await this.ui.verifyText("Create React App Template");
    await this.ui.waitForTextDisappear("Add ArgoCD to an existing project");
    await this.ui.clickButton("Choose");

    await this.ui.fillTextInputByLabel("Name", details.componentName);
    await this.ui.fillTextInputByLabel("Description", details.description);
    await this.ui.fillTextInputByLabel("Owner", details.owner);
    await this.ui.fillTextInputByLabel("Label", details.label);
    await this.ui.fillTextInputByLabel("Annotation", details.annotation);
    await this.ui.clickButton("Next");

    await this.ui.fillTextInputByLabel("Owner", details.repoOwner);
    await this.ui.fillTextInputByLabel("Repository", details.repo);
    await this.ui.pressTab();
    await this.ui.clickButton("Review");
  }

  async verifyCreateReactAppReviewTable(
    details: ReactAppTemplateDetails,
  ): Promise<void> {
    await this.ui.verifyRowInTableByUniqueText("Owner", [details.owner]);
    await this.ui.verifyRowInTableByUniqueText("Name", [details.componentName]);
    await this.ui.verifyRowInTableByUniqueText("Description", [
      details.description,
    ]);
    await this.ui.verifyRowInTableByUniqueText("Label", [details.label]);
    await this.ui.verifyRowInTableByUniqueText("Annotation", [
      details.annotation,
    ]);
    await this.ui.verifyRowInTableByUniqueText("Repository Location", [
      `${details.repoOwner}/${details.repo}`,
    ]);
  }

  async verifyCreateReactAppReviewTableWithGroupOwner(
    details: ReactAppTemplateDetails,
  ): Promise<void> {
    await this.ui.verifyRowInTableByUniqueText("Owner", [
      `group:${details.owner}`,
    ]);
    await this.ui.verifyRowInTableByUniqueText("Name", [details.componentName]);
    await this.ui.verifyRowInTableByUniqueText("Description", [
      details.description,
    ]);
    await this.ui.verifyRowInTableByUniqueText("Label", [details.label]);
    await this.ui.verifyRowInTableByUniqueText("Annotation", [
      details.annotation,
    ]);
    await this.ui.verifyRowInTableByUniqueText("Repository Location", [
      `github.com?owner=${details.repoOwner}&repo=${details.repo}`,
    ]);
  }

  async createAndOpenInCatalog(): Promise<void> {
    await this.ui.clickButton("Create");
    await this.ui.clickLink("Open in catalog");
  }

  async clickCreate(): Promise<void> {
    await this.ui.clickButton("Create");
  }

  async clickOpenInCatalog(): Promise<void> {
    await this.ui.clickLink("Open in catalog");
  }

  async waitForOpenInCatalogLink(timeout = 60_000): Promise<void> {
    await expect(
      this.page.getByRole("link", { name: "Open in catalog" }),
    ).toBeVisible({ timeout });
  }

  async verifyComponentNameVisible(
    name: string,
    timeout = 20_000,
  ): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible({ timeout });
  }

  async openTemplateFromCatalog(
    templateName: string,
    kindColumn = templateName,
  ): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.selectMuiBox("Kind", "Template");
    await this.ui.searchInputPlaceholder(`${templateName}\n`);
    await this.ui.verifyRowInTableByUniqueText(templateName, [kindColumn]);
    await this.ui.clickLink(templateName);
  }

  async launchTemplateAndVerifyIntro(): Promise<void> {
    await this.ui.clickLink("Launch Template");
    await this.ui.verifyText("Provide some simple information");
  }

  async openComponentInCatalog(
    componentName: string,
    kindColumn: string | string[] = "website",
  ): Promise<void> {
    await this.ui.openCatalogSidebar("Component");
    await this.ui.searchInputPlaceholder(componentName);
    const columns = Array.isArray(kindColumn) ? kindColumn : [kindColumn];
    await this.ui.verifyRowInTableByUniqueText(componentName, columns);
    await this.ui.clickLink(componentName);
  }

  async verifyDependencyGraphLabels(
    labelSelector: string,
    nodeSelector: string,
    relationLabel: string,
    nodePartialText: string,
  ): Promise<void> {
    await this.ui.verifyTextInSelector(labelSelector, relationLabel);
    await this.ui.verifyPartialTextInSelector(nodeSelector, nodePartialText);
  }

  async runHttpRequestTemplateFlow(): Promise<void> {
    await this.ui.openSidebar("Catalog");
    await this.ui.selectMuiBox("Kind", "Template");
    await this.ui.searchInputPlaceholder("Test HTTP Request");
    await this.ui.clickLink("Test HTTP Request");
    await this.ui.verifyHeading("Test HTTP Request");
    await this.ui.clickLink("Launch Template");
    await this.ui.verifyHeading("Self-service");
    await this.ui.clickButton("Create");
    await this.ui.verifyText("200", false);
  }
}
