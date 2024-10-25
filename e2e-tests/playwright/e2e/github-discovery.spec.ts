import { test as base, Page } from "@playwright/test";
import { Catalog } from "../support/pages/Catalog";
import GithubApi from "../support/api/github";
import { CATALOG_FILE, JANUS_QE_ORG } from "../utils/constants";
import { assert } from "console";
import { Common } from "../utils/Common";
import { GH_USER_IDAuthFile_rhdh } from "../support/auth/auth_constants";

type GithubDiscoveryFixture = {
  catalogPage: Catalog;
  githubApi: GithubApi;
  testOrganization: string;
};

const test = base.extend<GithubDiscoveryFixture>({
  catalogPage: async ({ page, context }, use) => {
    const myPage: Page = await Common.logintoGithub(context);
    const catalog = new Catalog(myPage);
    await catalog.go();
    use(catalog);
  },
  githubApi: new GithubApi(),
  testOrganization: JANUS_QE_ORG,
});

test.use({ storageState: GH_USER_IDAuthFile_rhdh });

test.describe("Github Discovery Catalog", () => {
  test(`Discover Organization's Catalog`, async ({
    catalogPage,
    githubApi,
    testOrganization,
  }) => {
    const organizationRepos = await githubApi.getReposFromOrg(testOrganization);
    const reposNames: string[] = organizationRepos.map((repo) => repo["name"]);
    const realComponents: string[] = reposNames.filter(
      async (repo) =>
        await githubApi.fileExistsOnRepo(
          `${testOrganization}/${repo}`,
          CATALOG_FILE,
        ),
    );

    for (let i = 0; i != realComponents.length; i++) {
      const repo = realComponents[i];
      await catalogPage.search(repo);
      const row = await catalogPage.tableRow(repo);
      assert(await row.isVisible());
    }
  });
});
