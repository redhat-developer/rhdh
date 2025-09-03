import { expect, test as base } from "@playwright/test";
import { Common } from "../../utils/common";
import { UIhelper } from "../../utils/ui-helper";
import { Clusters } from "../../support/pages/clusters";

//Pre-req: Enable backstage-community-plugin-ocm-backend-dynamic and backstage-community-plugin-ocm Plugins
//Pre-req: Install Advanced Cluster Management for Kubernetes "MultiClusterHub"
// https://access.redhat.com/documentation/en-us/red_hat_advanced_cluster_management_for_kubernetes/2.10/html/install/installing#installing-from-the-operatorhub

const clusterDetails = {
  clusterName: "testCluster",
  status: "Ready",
  platform: /IBM|AWS|GCP/,
  cpuCores: /CPU cores\d+/,
  memorySize: /Memory size\d.*(Gi|Mi)/,
  ocVersion: /^\d+\.\d+\.\d+(Upgrade available)?$/,
};

const test = base.extend<{
  common: Common;
  uiHelper: UIhelper;
  clusters: Clusters;
}>({
  common: async ({ page }, use) => {
    const common = new Common(page);
    await common.loginAsGuest();
    await use(common);
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  uiHelper: async ({ page, common }, use) => {
    const uiHelper = new UIhelper(page);
    await uiHelper.openSidebar("Clusters");
    await use(uiHelper);
  },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  clusters: async ({ page, uiHelper }, use) => {
    const clusters = new Clusters(page);
    await use(clusters);
  },
});

test.describe("Test OCM plugin", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "plugins",
    });
  });

  test("Navigate to Clusters and Verify OCM Clusters", async ({
    page,
    uiHelper,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    common,
    clusters,
  }) => {
    const expectedPath = "/ocm";

    // Wait for the expected path in the URL
    await page.waitForURL(`**${expectedPath}`, {
      waitUntil: "domcontentloaded", // Wait until the DOM is loaded
      timeout: 10000, // Set timeout to 10 seconds
    });

    expect(page.url()).toContain(expectedPath);

    await uiHelper.verifyHeading("Your Managed Clusters");
    await uiHelper.verifyRowInTableByUniqueText(clusterDetails.clusterName, [
      new RegExp(clusterDetails.status),
      clusterDetails.platform,
    ]);
    await uiHelper.verifyRowInTableByUniqueText(clusterDetails.clusterName, [
      clusterDetails.ocVersion,
    ]);
    await uiHelper.clickLink(clusterDetails.clusterName);

    await clusters.verifyOCMLinksCardDetails();
    await clusters.verifyOCMAvailableCardDetails(
      clusterDetails.cpuCores,
      clusterDetails.memorySize,
    );
    await clusters.verifyOCMClusterInfo(
      clusterDetails.clusterName,
      clusterDetails.status,
    );
  });

  test("Navigate to Catalog > resources and verify cluster", async ({
    uiHelper,
    common,
    clusters,
  }) => {
    await uiHelper.openSidebar("Catalog");
    await common.waitForLoad();
    await uiHelper.selectMuiBox("Kind", "Resource");
    await uiHelper.verifyRowsInTable([clusterDetails.clusterName]);
    await uiHelper.clickLink(clusterDetails.clusterName);
    await clusters.verifyOCMClusterInfo(
      clusterDetails.clusterName,
      clusterDetails.status,
    );
  });
});
