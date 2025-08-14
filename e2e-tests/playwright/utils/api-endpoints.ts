const baseApiUrl = "https://api.github.com";
const perPage = 100;

const getRepoUrl = (owner: string, repo: string) =>
  `${baseApiUrl}/repos/${owner}/${repo}`;
const getOrgUrl = (owner: string) => `${baseApiUrl}/orgs/${owner}`;

const backstageShowcaseAPI = getRepoUrl("janus-idp", "backstage-showcase");

export const GITHUB_API_ENDPOINTS = {
  pull: (owner: string, repo: string, state: "open" | "closed" | "all") =>
    `${getRepoUrl(owner, repo)}/pulls?per_page=${perPage}&state=${state}`,

  issues: (state: string) =>
    `${backstageShowcaseAPI}/issues?per_page=${perPage}&sort=updated&state=${state}`,

  workflowRuns: `${backstageShowcaseAPI}/actions/runs?per_page=${perPage}`,

  deleteRepo: getRepoUrl,

  mergePR: (owner: string, repoName: string, pullNumber: number) =>
    `${getRepoUrl(owner, repoName)}/pulls/${pullNumber}/merge`,

  createRepo: (owner: string) => `${getOrgUrl(owner)}/repos`,

  pull_files: (owner: string, repoName: string, pr: number) =>
    `${getRepoUrl(owner, repoName)}/pulls/${pr}/files`,

  contents: (owner: string, repoName: string) =>
    `${getRepoUrl(owner, repoName)}/contents`,
};
