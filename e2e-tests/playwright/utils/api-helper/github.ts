import { request, type APIResponse, expect } from "@playwright/test";

import { GITHUB_API_ENDPOINTS } from "../api-endpoints";
import {
  type GitHubPullRequestFile,
  isGitHubPullRequestFile,
  parseJsonResponse,
  toUnknownArray,
} from "./guards";

type FetchOptions = {
  method: string;
  headers: {
    Accept: string;
    Authorization: string;
    "X-GitHub-Api-Version": string;
  };
  data?: string | object;
};

const githubAPIVersion = "2022-11-28";

export async function githubRequest(
  method: string,
  url: string,
  body?: string | object,
): Promise<APIResponse> {
  const context = await request.newContext();
  const options: FetchOptions = {
    method: method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${process.env.GH_RHDH_QE_USER_TOKEN}`,
      "X-GitHub-Api-Version": githubAPIVersion,
    },
  };

  if (body !== undefined) {
    options.data = body;
  }

  const response = await context.fetch(url, options);
  return response;
}

async function getGithubPaginatedRequest(
  url: string,
  pageNo = 1,
  response: unknown[] = [],
): Promise<unknown[]> {
  const fullUrl = `${url}&page=${pageNo}`;
  const result = await githubRequest("GET", fullUrl);
  const body: unknown = await result.json();
  const pageItems = toUnknownArray(body);

  if (pageItems.length === 0) {
    return response;
  }

  response = response.concat(pageItems);
  return getGithubPaginatedRequest(url, pageNo + 1, response);
}

export { getGithubPaginatedRequest };

export async function createGitHubRepo(owner: string, repoName: string) {
  const response = await githubRequest("POST", GITHUB_API_ENDPOINTS.createRepo(owner), {
    name: repoName,
    private: false,
  });
  expect(response.status() === 201 || response.ok()).toBeTruthy();
}

export async function createFileInRepo(
  owner: string,
  repoName: string,
  filePath: string,
  content: string,
  commitMessage: string,
  branch = "main",
) {
  const encodedContent = Buffer.from(content).toString("base64");
  const response = await githubRequest(
    "PUT",
    `${GITHUB_API_ENDPOINTS.contents(owner, repoName)}/${filePath}`,
    {
      message: commitMessage,
      content: encodedContent,
      branch: branch,
    },
  );
  expect(response.status() === 201 || response.ok()).toBeTruthy();
}

export async function createGitHubRepoWithFile(
  owner: string,
  repoName: string,
  filename: string,
  fileContent: string,
) {
  await createGitHubRepo(owner, repoName);
  await createFileInRepo(owner, repoName, filename, fileContent, `Add ${filename} file`);
}

export async function initCommit(owner: string, repo: string, branch = "main") {
  const content = Buffer.from("This is the initial commit for the repository.").toString("base64");
  const response = await githubRequest(
    "PUT",
    `${GITHUB_API_ENDPOINTS.contents(owner, repo)}/initial-commit.md`,
    {
      message: "Initial commit",
      content: content,
      branch: branch,
    },
  );
  expect(response.status() === 201 || response.ok()).toBeTruthy();
}

export async function deleteGitHubRepo(owner: string, repoName: string) {
  await githubRequest("DELETE", GITHUB_API_ENDPOINTS.deleteRepo(owner, repoName));
}

export async function mergeGitHubPR(owner: string, repoName: string, pullNumber: number) {
  await githubRequest("PUT", GITHUB_API_ENDPOINTS.mergePR(owner, repoName, pullNumber));
}

export async function getGitHubPRs(
  owner: string,
  repoName: string,
  state: "open" | "closed" | "all",
  paginated = false,
) {
  const url = GITHUB_API_ENDPOINTS.pull(owner, repoName, state);
  if (paginated) {
    return getGithubPaginatedRequest(url);
  }
  const response = await githubRequest("GET", url);
  return parseJsonResponse(response);
}

export async function getfileContentFromPR(
  owner: string,
  repoName: string,
  pr: number,
  filename: string,
): Promise<string> {
  const response = await githubRequest("GET", GITHUB_API_ENDPOINTS.pull_files(owner, repoName, pr));
  const files: unknown = await parseJsonResponse(response);
  if (!Array.isArray(files)) {
    throw new TypeError(
      `Expected PR files array but got ${typeof files}: ${JSON.stringify(files)}`,
    );
  }
  const file = files.find(
    (entry): entry is GitHubPullRequestFile =>
      isGitHubPullRequestFile(entry) && entry.filename === filename,
  );
  if (file === undefined) {
    throw new Error(`File ${filename} not found in PR ${pr}`);
  }
  const rawFileContent = await (await githubRequest("GET", file.raw_url)).text();
  return rawFileContent;
}
