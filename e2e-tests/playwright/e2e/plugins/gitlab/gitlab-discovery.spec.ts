import { guestTest } from "../../../support/fixtures/guest-login";

// Pre-req: backstage-plugin-catalog-backend-module-gitlab-dynamic
// Pre-req: immobiliarelabs-backstage-plugin-gitlab-backend-dynamic
guestTest.describe("gitlab discovery UI tests", () => {
  guestTest(
    "GitLab integration for discovering catalog entities from GitLab",
    async ({ uiHelper }) => {
      await uiHelper.openSidebar("Catalog");
      await uiHelper.verifyText("rhdh-my-new-service");
      await uiHelper.clickLink("rhdh-my-new-service");
      await uiHelper.verifyHeading("rhdh-my-new-service");
      await uiHelper.verifyText("Description of my new service");
      await uiHelper.verifyText("java");
      await uiHelper.verifyText("production");
      await uiHelper.verifyLink("team-a");
      await uiHelper.verifyLink("project-x");
      await uiHelper.verifyLink("View Source");
    },
  );
});
