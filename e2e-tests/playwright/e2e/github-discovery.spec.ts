import { test as base, expect } from "@playwright/test";
import GithubApi from "../support/api/github";
import { CATALOG_FILE, JANUS_QE_ORG } from "../utils/constants";
import { Common } from "../utils/common";
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

  test(`Discover Organization's Catalog`, async ({
    catalogPage,
    githubApi,
    testOrganization,
  }) => {
    const organizationRepos = await githubApi.getReposFromOrg(testOrganization);

    const reposNames: string[] = (organizationRepos as Array<{ name?: string }>)
      .map((repo) => repo.name)
      .filter((name): name is string => typeof name === "string")
      // filter for subset of organization repositories where the repository name matches the entity name
      .filter((name) => name.startsWith("test-annotator"))
      .slice(0, 5);

    const reposWithCatalogInfo: string[] = (
      await Promise.all(
        reposNames.map(async (repo) =>
          (await githubApi.fileExistsInRepo(
            testOrganization,
            repo,
            CATALOG_FILE,
          ))
            ? repo
            : null,
        ),
      )
    ).filter((repo): repo is string => typeof repo === "string");

    expect(reposWithCatalogInfo.length).toBeGreaterThan(0);

    for (const repo of reposWithCatalogInfo) {
      await catalogPage.search(repo);
      const row = await catalogPage.tableRow(repo);
      await expect(row).toBeVisible();
    }
  });
});
