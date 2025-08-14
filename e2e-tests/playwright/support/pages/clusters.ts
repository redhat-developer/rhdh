import { Page } from "@playwright/test";
import { UIhelper } from "../../utils/ui-helper";

export class Clusters {
  private page: Page;
  private uiHelper: UIhelper;

  constructor(page: Page) {
    this.page = page;
    this.uiHelper = new UIhelper(page);
  }

  async verifyOCMLinksCardDetails() {
    await this.uiHelper.verifyLinkinCard("Links", "OpenShift Console", false);
    await this.uiHelper.verifyLinkinCard("Links", "OCM Console", false);
    await this.uiHelper.verifyLinkinCard(
      "Links",
      "OpenShift Cluster Manager",
      false,
    );
  }

  async verifyOCMAvailableCardDetails(cpuCores: RegExp, memorySize: RegExp) {
    await this.uiHelper.verifyTextinCard("Available", cpuCores);
    await this.uiHelper.verifyTextinCard("Available", memorySize);
  }

  async verifyOCMClusterInfo(clusterName: string, status: string) {
    await this.uiHelper.verifyTextinCard("Cluster Info", `Name${clusterName}`);
    await this.uiHelper.verifyTextinCard("Cluster Info", `Status${status}`);
  }
}
