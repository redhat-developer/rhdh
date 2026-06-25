import { test } from "@support/coverage/test";

import { getTranslations, getCurrentLanguage } from "../e2e/localization/locale";
import { CatalogBrowsePage } from "../support/pages/catalog-browse-page";
import { CatalogImport } from "../support/pages/catalog-import";
import { SelfServicePage } from "../support/pages/self-service-page";
import { JOB_NAME_PATTERNS } from "../utils/constants";
import { skipIfJobName } from "../utils/helper";

const t = getTranslations();
const lang = getCurrentLanguage();

test.describe("Test timestamp column on Catalog", () => {
  test.skip(
    () => skipIfJobName(JOB_NAME_PATTERNS.OSD_GCP),
    "skipping on OSD-GCP cluster due to RHDHBUGS-555",
  );

  let catalogBrowsePage: CatalogBrowsePage;
  let selfServicePage: SelfServicePage;
  let catalogImport: CatalogImport;

  const component =
    "https://github.com/janus-qe/custom-catalog-entities/blob/main/timestamp-catalog-info.yaml";

  test.describe.configure({ mode: "serial" });

  test.beforeAll(({ rhdhGuestPage }) => {
    test.info().annotations.push({
      type: "component",
      description: "core",
    });

    catalogBrowsePage = new CatalogBrowsePage(rhdhGuestPage);
    selfServicePage = new SelfServicePage(rhdhGuestPage);
    catalogImport = new CatalogImport(rhdhGuestPage);
  });

  test.beforeEach(async () => {
    await catalogBrowsePage.openSidebar(t["rhdh"][lang]["menuItem.catalog"]);
    await catalogBrowsePage.verifyHeading(
      t["catalog"][lang]["indexPage.title"].replace("{{orgName}}", "My Org"),
    );
    await catalogBrowsePage.openCatalogSidebar("Component");
  });

  test("Import an existing Git repository and verify `Created At` column and value in the Catalog Page", async () => {
    await selfServicePage.open();
    await selfServicePage.clickImportGitRepositoryLocalized(
      t["scaffolder"][lang]["templateListPage.contentHeader.registerExistingButtonTitle"],
    );
    await catalogImport.registerExistingComponent(component);
    await catalogBrowsePage.openCatalogSidebar("Component");
    await catalogBrowsePage.searchCatalog("timestamp-test-created");
    await catalogBrowsePage.verifyText("timestamp-test-created");
    await catalogBrowsePage.verifyColumnHeading(["Created At"], true);
    await catalogBrowsePage.verifyRowByUniqueText("timestamp-test-created", [
      /^\d{1,2}\/\d{1,2}\/\d{1,4}, \d:\d{1,2}:\d{1,2} (AM|PM)$/u,
    ]);
  });

  test("Toggle 'CREATED AT' to see if the component list can be sorted in ascending/decending order", async () => {
    await catalogBrowsePage.clearSearchIfVisible();
    await catalogBrowsePage.sortCreatedAtDescending();
    await catalogBrowsePage.verifyFirstRowCreatedAtNotEmpty();
  });
});
