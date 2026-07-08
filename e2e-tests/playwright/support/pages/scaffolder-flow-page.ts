import { expect, Page } from "@playwright/test";

import * as interaction from "../../utils/ui-helper/interaction";
import * as navigation from "../../utils/ui-helper/navigation";
import * as table from "../../utils/ui-helper/table";
import * as verification from "../../utils/ui-helper/verification";
import { SEARCH_OBJECTS_COMPONENTS } from "../selectors/page-selectors";

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

  constructor(page: Page) {
    this.page = page;
  }

  private async fillSearch(query: string): Promise<void> {
    await this.page.fill(SEARCH_OBJECTS_COMPONENTS.placeholderSearch, query);
  }

  async openSelfServiceFromCatalog(): Promise<void> {
    await navigation.openSidebar(this.page, "Catalog");
    await interaction.clickButton(this.page, "Self-service");
  }

  async verifySelfServiceHeading(): Promise<void> {
    await verification.verifyHeading(this.page, "Self-service");
  }

  async clickImportGitRepository(): Promise<void> {
    await interaction.clickButton(this.page, "Import an existing Git repository");
  }

  async fillCreateReactAppTemplateForm(details: ReactAppTemplateDetails): Promise<void> {
    await this.fillSearch("Create React App Template");
    await verification.verifyText(this.page, "Create React App Template");
    await verification.waitForTextDisappear(this.page, "Add ArgoCD to an existing project");
    await interaction.clickButton(this.page, "Choose");
    await this.fillCreateReactAppTemplateSteps(details);
  }

  private async fillCreateReactAppTemplateSteps(details: ReactAppTemplateDetails): Promise<void> {
    await interaction.fillTextInputByLabel(this.page, "Name", details.componentName);
    await interaction.fillTextInputByLabel(this.page, "Description", details.description);
    await interaction.fillTextInputByLabel(this.page, "Owner", details.owner);
    await interaction.fillTextInputByLabel(this.page, "Label", details.label);
    await interaction.fillTextInputByLabel(this.page, "Annotation", details.annotation);
    await interaction.clickButton(this.page, "Next");

    await interaction.fillTextInputByLabel(this.page, "Owner", details.repoOwner);
    await interaction.fillTextInputByLabel(this.page, "Repository", details.repo);
    await interaction.pressTab(this.page);
    await interaction.clickButton(this.page, "Review");
  }

  private async verifyCreateReactAppReviewRows(
    details: ReactAppTemplateDetails,
    ownerValue: string,
    repoLocation: string,
  ): Promise<void> {
    await table.verifyRowInTableByUniqueText(this.page, "Owner", [ownerValue]);
    await table.verifyRowInTableByUniqueText(this.page, "Name", [details.componentName]);
    await table.verifyRowInTableByUniqueText(this.page, "Description", [details.description]);
    await table.verifyRowInTableByUniqueText(this.page, "Label", [details.label]);
    await table.verifyRowInTableByUniqueText(this.page, "Annotation", [details.annotation]);
    await table.verifyRowInTableByUniqueText(this.page, "Repository Location", [repoLocation]);
  }

  async verifyCreateReactAppReviewTableWithGroupOwner(
    details: ReactAppTemplateDetails,
  ): Promise<void> {
    await this.verifyCreateReactAppReviewRows(
      details,
      `group:${details.owner}`,
      `github.com?owner=${details.repoOwner}&repo=${details.repo}`,
    );
  }

  async clickCreate(): Promise<void> {
    await interaction.clickButton(this.page, "Create");
  }

  async clickOpenInCatalog(): Promise<void> {
    await interaction.clickLink(this.page, "Open in catalog");
  }

  async waitForOpenInCatalogLink(timeout = 60_000): Promise<void> {
    await expect(this.page.getByRole("link", { name: "Open in catalog" })).toBeVisible({ timeout });
  }

  async verifyComponentNameVisible(name: string, timeout = 20_000): Promise<void> {
    await expect(this.page.getByText(name)).toBeVisible({ timeout });
  }

  async openTemplateFromCatalog(templateName: string, kindColumn = templateName): Promise<void> {
    await navigation.openTemplateInCatalog(this.page, templateName, kindColumn);
  }

  async launchTemplateAndVerifyIntro(): Promise<void> {
    await interaction.clickLink(this.page, "Launch Template");
    await verification.verifyText(this.page, "Provide some simple information");
  }

  async openComponentInCatalog(
    componentName: string,
    kindColumn: string | string[] = "website",
  ): Promise<void> {
    await navigation.openCatalogSidebar(this.page, "Component");
    await this.fillSearch(componentName);
    const columns = Array.isArray(kindColumn) ? kindColumn : [kindColumn];
    await table.verifyRowInTableByUniqueText(this.page, componentName, columns);
    await interaction.clickLink(this.page, componentName);
  }

  async verifyDependencyGraphLabels(
    labelSelector: string,
    nodeSelector: string,
    relationLabel: string,
    nodePartialText: string,
  ): Promise<void> {
    await verification.verifyTextInSelector(this.page, labelSelector, relationLabel);
    await verification.verifyPartialTextInSelector(this.page, nodeSelector, nodePartialText);
  }

  async runHttpRequestTemplateFlow(): Promise<void> {
    await navigation.openSidebar(this.page, "Catalog");
    await navigation.selectMuiBox(this.page, "Kind", "Template");
    await this.fillSearch("Test HTTP Request");
    await interaction.clickLink(this.page, "Test HTTP Request");
    await verification.verifyHeading(this.page, "Test HTTP Request");
    await interaction.clickLink(this.page, "Launch Template");
    await verification.verifyHeading(this.page, "Self-service");
    await interaction.clickButton(this.page, "Create");
    await verification.verifyText(this.page, "200", false);
  }
}
