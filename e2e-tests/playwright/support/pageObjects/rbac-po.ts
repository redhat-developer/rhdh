import { expect, Locator, Page } from "@playwright/test";
import { PageObject, PagesUrl } from "./page";
import { SEARCH_OBJECTS_COMPONENTS } from "./page-obj";

type PermissionPolicyType = "none" | "anyOf" | "not";

export class RbacPo extends PageObject {
  private article: Locator;
  private updateMemberButton: Locator;
  // roles
  private roleName: Locator;
  private roledescription: Locator;
  private usersAndGroupsField: Locator;
  private addPermissionPolicy: Locator;
  private configureAccess: Locator;
  private notButton: Locator;
  private rulesSideBar: Locator;
  private hasSpecButton: Locator;
  private key: Locator;
  private saveConditions: Locator;
  private anyOfButton: Locator;
  private isEntityKindButton: Locator;
  private addRuleButton: Locator = this.page.getByRole("button", {
    name: "Add rule",
  });

  private hasLabel: Locator;
  private label: Locator;

  static rbacTestUsers = {
    guest: "Guest User",
    tara: "Tara MacGovern",
    backstage: "Backstage",
    rhdhqe: "rhdh-qe",
  };
  private selectPluginsCombobox: Locator = this.page.getByRole("combobox", {
    name: "Select plugins",
  });

  private stringForRegexUsersAndGroups = (
    numUsers: number,
    numGroups: number,
  ): string => {
    const usersText = `${numUsers} ${numUsers === 1 ? "user" : "users"}`;
    const groupsText = `${numGroups} ${numGroups === 1 ? "group" : "groups"}`;
    return `(${groupsText}, ${usersText}|${usersText}, ${groupsText})`;
  };

  public regexpShortUsersAndGroups = (
    numUsers: number,
    numGroups: number,
  ): RegExp => {
    return new RegExp(this.stringForRegexUsersAndGroups(numUsers, numGroups));
  };

  public regexpLongUsersAndGroups = (
    numUsers: number,
    numGroups: number,
  ): RegExp => {
    return new RegExp(
      `Users and groups \\(${this.stringForRegexUsersAndGroups(numUsers, numGroups)}\\)`,
    );
  };

  selectMember(label: string): string {
    return `span[data-testid="${label}"]`;
  }

  public selectPermissionPolicyPlugin(row: number): string {
    return `input[name="permissionPoliciesRows[${row}].plugin"]`;
  }

  selectPermissionPolicyPermission(row: number): string {
    return `input[name="permissionPoliciesRows[${row}].permission"]`;
  }

  private selectPolicy(
    row: number,
    policy: number,
    policyName = "Delete",
  ): string {
    return `input[name="permissionPoliciesRows[${row}].policies[${policy}].policy-${policyName}"]`;
  }

  constructor(page: Page, url: PagesUrl = PagesUrl.RBAC) {
    super(page, url);
    this.article = this.page.getByRole("article");
    this.updateMemberButton = this.page
      .getByTestId("update-members")
      .getByLabel("Update");
    this.roleName = this.page.locator('input[name="name"]');
    this.roledescription = this.page.locator('input[name="description"]');
    this.usersAndGroupsField = this.page.locator(
      'input[name="add-users-and-groups"]',
    );
    this.addPermissionPolicy = this.page.locator(
      'button[name="add-permission-policy"]',
    );
    this.configureAccess = this.page.getByLabel("configure-access");
    this.notButton = this.page.getByRole("button", { name: "Not" });
    this.rulesSideBar = this.page.getByTestId("rules-sidebar");
    this.hasSpecButton = this.page.getByText("HAS_SPEC");
    this.key = this.page.getByLabel("key *");
    this.saveConditions = this.page.getByTestId("save-conditions");
    this.anyOfButton = this.page.getByRole("button", { name: "AnyOf" });
    this.isEntityKindButton = this.page.getByText("IS_ENTITY_KIND");
    this.hasLabel = this.page.getByText("HAS_LABEL");
    this.label = this.page.getByLabel("label *");
  }

  public async clickAddPermissionPolicy() {
    await this.addPermissionPolicy.click();
  }

  private async verifyGeneralRbacViewHeading() {
    await this.uiHelper.verifyHeading(/All roles \(\d+\)/);
  }

  private async verifyUserRoleViewHeading(role: string) {
    await this.uiHelper.verifyHeading(role);
  }

  private async verifyRoleIsListed(role: string) {
    await this.uiHelper.verifyLink(role);
  }

  private async clickOnRoleLink(role: string) {
    await this.uiHelper.clickLink(role);
  }

  private async switchToOverView() {
    await this.uiHelper.clickTab("Overview");
  }

  private async verifyOverviewHeading(groups: number) {
    await this.uiHelper.verifyHeading(`${groups} group`);
  }

  private async verifyPermissionPoliciesHeader(policies: number) {
    await this.uiHelper.verifyText(`Permission policies (${policies})`);
  }

  private async verifyArticle() {
    await expect(this.article).toContainText("catalog-entity");
    await expect(this.article).toContainText("Read, Update");
    await expect(this.article).toContainText("Delete");
  }

  private async updateMember(member: string) {
    await this.updateMemberButton.click();
    await this.verifyATextIsVisible(member);
  }

  private async next() {
    this.uiHelper.clickButton("Next");
  }

  private async create() {
    await this.uiHelper.clickButton("Create");
  }

  public async selectOption(
    option:
      | "catalog"
      | "catalog.entity.read"
      | "scaffolder"
      | "scaffolder-template",
  ) {
    const optionSelector = `li[role="option"]:has-text("${option}")`;
    await this.page.waitForSelector(optionSelector);
    await this.page.click(optionSelector);
  }

  private async clickOpenSidebar() {
    await this.rulesSideBar.getByLabel("Open").click();
  }

  private async verifyConfigureAccessNumber(rules: number) {
    await this.uiHelper.verifyText(
      `Configure access (${rules} ${rules > 1 ? "rules" : "rule"})`,
    );
  }

  async addUsersAndGroups(userOrRole: string) {
    await this.usersAndGroupsField.fill(userOrRole);
  }

  async createRole(
    name: string,
    usersAndGroups: string[],
    permissionPolicyType: PermissionPolicyType = "none",
  ) {
    if (!this.page.url().includes("rbac")) await this.goto();
    await this.uiHelper.clickButton("Create");
    await this.uiHelper.verifyHeading("Create role");
    await this.roleName.fill(name);
    await this.uiHelper.clickButton("Next");
    await this.usersAndGroupsField.click();

    for (const userOrRole of usersAndGroups) {
      // await this.addUsersAndGroups(userOrRole);
      await this.page.click(this.selectMember(userOrRole));
    }

    // Close dropdown after selecting users and groups
    await this.page.getByTestId("ArrowDropDownIcon").click();

    // Dynamically verify the heading based on users and groups added
    const numUsers = usersAndGroups.length;
    const numGroups = 1; // Update this based on your logic
    await this.uiHelper.verifyHeading(
      this.regexpShortUsersAndGroups(numUsers - numGroups, numGroups),
    );

    await this.next();
    await this.selectPluginsCombobox.click();
    await this.selectOption("catalog");
    await this.page.getByTestId("expand-row-catalog").click();
    await this.selectOption("catalog.entity.read");

    if (permissionPolicyType === "none") {
      await this.page.uncheck(this.selectPolicy(0, 1, "Delete"));
      await this.next();
      await this.uiHelper.verifyHeading("Review and create");
      await this.uiHelper.verifyText(
        this.regexpLongUsersAndGroups(numUsers - numGroups, numGroups),
      );
      await this.verifyPermissionPoliciesHeader(2);
      await this.create();
      await this.page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .waitFor();
      await this.page
        .locator(SEARCH_OBJECTS_COMPONENTS.ariaLabelSearch)
        .fill(name);
      await this.uiHelper.verifyHeading("All roles (1)");
    } else if (permissionPolicyType === "anyOf") {
      // Scenario 2: Permission policies using AnyOf
      await this.configureAccess.click();
      await this.anyOfButton.click();
      await this.clickOpenSidebar();
      await this.isEntityKindButton.click();
      await this.page.getByPlaceholder("string, string").click();
      await this.page
        .getByPlaceholder("string, string")
        .fill("component,template");
      await this.addRuleButton.click();
      await this.page.getByLabel("Open").nth(3).click();
      await this.hasSpecButton.click();
      await this.key.click();
      await this.key.fill("lifecycle");
      await this.key.press("Tab");
      await this.key.fill("experimental");
      await this.addRuleButton.click();
      await this.page.getByLabel("Open").nth(4).click();
      await this.hasLabel.click();
      await this.label.click();
      await this.label.fill("partner");
      await this.saveConditions.click();
      await this.uiHelper.verifyText("Configure access (3 rules)");
      await this.next();
      await this.uiHelper.verifyHeading("Review and create");
      await this.uiHelper.verifyText(
        this.regexpLongUsersAndGroups(numUsers - numGroups, numGroups),
      );
      await this.verifyPermissionPoliciesHeader(1);
      await this.uiHelper.verifyText("3 rules");
      await this.uiHelper.clickButton("Create");
      await this.uiHelper.verifyText(
        `Role role:default/${name} created successfully`,
      );
    } else if (permissionPolicyType === "not") {
      // Scenario 3: Permission policies using Not
      await this.configureAccess.click();
      await this.notButton.click();
      await this.clickOpenSidebar();
      await this.hasSpecButton.click();
      await this.key.click();
      await this.key.fill("lifecycle");
      await this.key.press("Tab");
      await this.key.fill("experimental");
      await this.saveConditions.click();
      await this.uiHelper.verifyText("Configure access (1 rule)");
      await this.next();
      await this.uiHelper.verifyHeading("Review and create");
      await this.verifyPermissionPoliciesHeader(1);
      await this.uiHelper.verifyText("1 rule");
      await this.uiHelper.clickButton("Create");
      await this.uiHelper.verifyText(`role:default/${name}`);
    }
  }
}
