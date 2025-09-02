import { test as base } from "@playwright/test";
import GithubApi from "../support/api/github";
import { CATALOG_FILE, JANUS_QE_ORG } from "../utils/constants";
import { Common } from "../utils/common";
import { assert } from "console";
import { Catalog } from "../support/pages/catalog";
type GithubDiscoveryFixture = {
  catalogPage: Catalog;
  githubApi: GithubApi;
  testOrganization: string;
};

const test = base.extend<GithubDiscoveryFixture>({
  catalogPage: async ({ page }, use) => {
    await new Common(page).loginAsGithubUser();
    const catalog = new Catalog(page);
    await catalog.go();
    await use(catalog);
  },
  githubApi: new GithubApi(),
  testOrganization: JANUS_QE_ORG,
});

test.describe("Github Discovery Catalog", () => {
  test.beforeAll(async () => {
    test.info().annotations.push({
      type: "component",
      description: "api",
    });
  });

  //TODO: https://issues.redhat.com/browse/RHIDP-4992
  test.fixme(
    `Discover Organization's Catalog`,
    async ({ catalogPage, githubApi, testOrganization }) => {
      const organizationRepos =
        await githubApi.getReposFromOrg(testOrganization);
      const reposNames: string[] = organizationRepos.map(
        (repo) => repo["name"],
      );
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
    },
  );
});
