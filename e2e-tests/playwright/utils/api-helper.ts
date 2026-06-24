import { GroupEntity, UserEntity } from "@backstage/catalog-model";
import { request, APIResponse, expect } from "@playwright/test";

import { GITHUB_API_ENDPOINTS } from "./api-endpoints";

type FetchOptions = {
  method: string;
  headers: {
    Accept: string;
    Authorization: string;
    "X-GitHub-Api-Version": string;
  };
  data?: string | object;
};

interface GitHubPullRequestFile {
  filename: string;
  raw_url: string;
}

interface GuestTokenResponse {
  backstageIdentity: {
    token: string;
  };
}

interface EntityMetadataResponse {
  metadata?: {
    uid?: string;
  };
}

interface CatalogLocationEntry {
  data?: {
    target?: string;
    id?: string;
  };
}

function isGitHubPullRequestFile(value: unknown): value is GitHubPullRequestFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "raw_url" in value &&
    typeof value.raw_url === "string"
  );
}

function isGuestTokenResponse(value: unknown): value is GuestTokenResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    "backstageIdentity" in value &&
    typeof value.backstageIdentity === "object" &&
    value.backstageIdentity !== null &&
    "token" in value.backstageIdentity &&
    typeof value.backstageIdentity.token === "string"
  );
}

function isEntityMetadataResponse(value: unknown): value is EntityMetadataResponse {
  return typeof value === "object" && value !== null;
}

function isCatalogLocationEntry(value: unknown): value is CatalogLocationEntry {
  return typeof value === "object" && value !== null;
}

function isUserEntity(value: unknown): value is UserEntity {
  return isEntityMetadataResponse(value) && "kind" in value && value.kind === "User";
}

function isGroupEntity(value: unknown): value is GroupEntity {
  return isEntityMetadataResponse(value) && "kind" in value && value.kind === "Group";
}

async function parseJsonResponse(response: APIResponse): Promise<unknown> {
  return response.json();
}

function toUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected array but got ${typeof value}: ${JSON.stringify(value)}`);
  }
  const items: unknown[] = [];
  for (const item of value) {
    items.push(item);
  }
  return items;
}

export class APIHelper {
  private static githubAPIVersion = "2022-11-28";
  private staticToken = "";
  private baseUrl = "";
  useStaticToken = false;

  static async githubRequest(
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
        "X-GitHub-Api-Version": this.githubAPIVersion,
      },
    };

    if (body) {
      options.data = body;
    }

    const response = await context.fetch(url, options);
    return response;
  }

  static async getGithubPaginatedRequest(
    url: string,
    pageNo = 1,
    response: unknown[] = [],
  ): Promise<unknown[]> {
    const fullUrl = `${url}&page=${pageNo}`;
    const result = await this.githubRequest("GET", fullUrl);
    const body: unknown = await result.json();
    const pageItems = toUnknownArray(body);

    if (pageItems.length === 0) {
      return response;
    }

    response = response.concat(pageItems);
    return await this.getGithubPaginatedRequest(url, pageNo + 1, response);
  }

  static async createGitHubRepo(owner: string, repoName: string) {
    const response = await APIHelper.githubRequest("POST", GITHUB_API_ENDPOINTS.createRepo(owner), {
      name: repoName,
      private: false,
    });
    expect(response.status() === 201 || response.ok()).toBeTruthy();
  }

  static async createGitHubRepoWithFile(
    owner: string,
    repoName: string,
    filename: string,
    fileContent: string,
  ) {
    // Create the repository
    await APIHelper.createGitHubRepo(owner, repoName);

    // Add the specified file
    await APIHelper.createFileInRepo(
      owner,
      repoName,
      filename,
      fileContent,
      `Add ${filename} file`,
    );
  }

  static async createFileInRepo(
    owner: string,
    repoName: string,
    filePath: string,
    content: string,
    commitMessage: string,
    branch = "main",
  ) {
    const encodedContent = Buffer.from(content).toString("base64");
    const response = await APIHelper.githubRequest(
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

  static async initCommit(owner: string, repo: string, branch = "main") {
    const content = Buffer.from("This is the initial commit for the repository.").toString(
      "base64",
    );
    const response = await APIHelper.githubRequest(
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

  static async deleteGitHubRepo(owner: string, repoName: string) {
    await APIHelper.githubRequest("DELETE", GITHUB_API_ENDPOINTS.deleteRepo(owner, repoName));
  }

  static async mergeGitHubPR(owner: string, repoName: string, pullNumber: number) {
    await APIHelper.githubRequest("PUT", GITHUB_API_ENDPOINTS.mergePR(owner, repoName, pullNumber));
  }

  static async getGitHubPRs(
    owner: string,
    repoName: string,
    state: "open" | "closed" | "all",
    paginated = false,
  ) {
    const url = GITHUB_API_ENDPOINTS.pull(owner, repoName, state);
    if (paginated) {
      return APIHelper.getGithubPaginatedRequest(url);
    }
    const response = await APIHelper.githubRequest("GET", url);
    return parseJsonResponse(response);
  }

  static async getfileContentFromPR(
    owner: string,
    repoName: string,
    pr: number,
    filename: string,
  ): Promise<string> {
    const response = await APIHelper.githubRequest(
      "GET",
      GITHUB_API_ENDPOINTS.pull_files(owner, repoName, pr),
    );
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
    if (!file) {
      throw new Error(`File ${filename} not found in PR ${pr}`);
    }
    const rawFileContent = await (await APIHelper.githubRequest("GET", file.raw_url)).text();
    return rawFileContent;
  }

  async getGuestToken(): Promise<string> {
    const context = await request.newContext();
    const response = await context.post("/api/auth/guest/refresh");
    expect(response.status()).toBe(200);
    const data: unknown = await parseJsonResponse(response);
    if (!isGuestTokenResponse(data)) {
      throw new Error("Guest token not found in response body");
    }
    return data.backstageIdentity.token;
  }

  async getGuestAuthHeader(): Promise<{ [key: string]: string }> {
    const token = await this.getGuestToken();
    const headers = {
      Authorization: `Bearer ${token}`,
    };
    return headers;
  }

  async UseStaticToken(token: string) {
    this.useStaticToken = true;
    this.staticToken = "Bearer " + token;
  }

  async UseBaseUrl(url: string) {
    this.baseUrl = url;
  }

  static async APIRequestWithStaticToken(
    method: string,
    url: string,
    staticToken: string,
    body?: string | object,
  ): Promise<APIResponse> {
    const context = await request.newContext();
    const options: {
      method: string;
      headers: {
        Accept: string;
        Authorization: string;
      };
      data?: string | object;
    } = {
      method: method,
      headers: {
        Accept: "application/json",
        Authorization: staticToken,
      },
    };

    if (body) {
      options.data = body;
    }

    const response = await context.fetch(url, options);
    return response;
  }

  async getAllCatalogUsersFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Duser`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    return parseJsonResponse(response);
  }

  async getAllCatalogLocationsFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Dlocation`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    return parseJsonResponse(response);
  }

  async getAllCatalogGroupsFromAPI(): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-query?orderField=metadata.name%2Casc&filter=kind%3Dgroup`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    return parseJsonResponse(response);
  }

  async getGroupEntityFromAPI(group: string): Promise<unknown> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/group/default/${group}`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    return parseJsonResponse(response);
  }

  async getCatalogUserFromAPI(user: string): Promise<UserEntity> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/user/default/${user}`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    const body: unknown = await parseJsonResponse(response);
    if (!isUserEntity(body)) {
      throw new TypeError(`Invalid catalog user response for ${user}`);
    }
    return body;
  }

  async deleteUserEntityFromAPI(user: string): Promise<string | undefined> {
    const r = await this.getCatalogUserFromAPI(user);
    if (!r.metadata?.uid) {
      return undefined;
    }
    const url = `${this.baseUrl}/api/catalog/entities/by-uid/${r.metadata.uid}`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("DELETE", url, token);
    return response.statusText();
  }

  async getCatalogGroupFromAPI(group: string): Promise<GroupEntity> {
    const url = `${this.baseUrl}/api/catalog/entities/by-name/group/default/${group}`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("GET", url, token);
    const body: unknown = await parseJsonResponse(response);
    if (!isGroupEntity(body)) {
      throw new TypeError(`Invalid catalog group response for ${group}`);
    }
    return body;
  }

  async deleteGroupEntityFromAPI(group: string): Promise<string> {
    const r = await this.getCatalogGroupFromAPI(group);
    const url = `${this.baseUrl}/api/catalog/entities/by-uid/${r.metadata.uid}`;
    const token = this.useStaticToken ? this.staticToken : "";
    const response = await APIHelper.APIRequestWithStaticToken("DELETE", url, token);
    return response.statusText();
  }

  async scheduleEntityRefreshFromAPI(entity: string, kind: string, token: string) {
    const url = `${this.baseUrl}/api/catalog/refresh`;
    const reqBody = { entityRef: `${kind}:default/${entity}` };
    const responseRefresh = await APIHelper.APIRequestWithStaticToken("POST", url, token, reqBody);
    return responseRefresh.status();
  }

  /**
   * Fetches the UID of an entity by its name from the Backstage catalog.
   *
   * @param name - The name of the entity (e.g., 'hello-world-2').
   * @returns The UID string if found, otherwise undefined.
   */
  static async getEntityUidByName(name: string): Promise<string | undefined> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/entities/by-name/template/default/${name}`;
    const context = await request.newContext();
    const response = await context.get(url);
    if (response.status() !== 200) {
      return undefined;
    }
    const data: unknown = await parseJsonResponse(response);
    if (!isEntityMetadataResponse(data)) {
      return undefined;
    }
    return data.metadata?.uid;
  }

  /**
   * Deletes a location from the Backstage catalog by its UID.
   *
   * @param uid - The UID of the location to delete.
   * @returns The status code of the delete operation.
   */
  static async deleteLocationByUid(uid: string): Promise<number> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/locations/${uid}`;
    const context = await request.newContext();
    const response = await context.delete(url);
    return response.status();
  }

  /**
   * Fetches the UID of a Template entity by its name and namespace from the Backstage catalog.
   *
   * @param name - The name of the template entity (e.g., 'hello-world-2').
   * @param namespace - The namespace of the template entity (default: 'default').
   * @returns The UID string if found, otherwise undefined.
   */
  static async getTemplateEntityUidByName(
    name: string,
    namespace: string = "default",
  ): Promise<string | undefined> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/locations/by-entity/template/${namespace}/${name}`;
    const context = await request.newContext();
    const response = await context.get(url);
    if (response.status() === 200) {
      const data: unknown = await parseJsonResponse(response);
      if (!isEntityMetadataResponse(data)) {
        return undefined;
      }
      return data.metadata?.uid;
    }
    if (response.status() === 404) {
      return undefined;
    }
    return undefined;
  }

  /**
   * Deletes an entity location from the Backstage catalog by its ID.
   *
   * @param id - The ID of the entity to delete.
   * @returns The status code of the delete operation.
   */
  static async deleteEntityLocationById(id: string): Promise<number> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/locations/${id}`;
    const context = await request.newContext();
    const response = await context.delete(url);
    return response.status();
  }

  /**
   * Registers a new location in the Backstage catalog.
   *
   * @param target - The target URL of the location to register.
   * @returns The status code of the registration operation.
   */
  static async registerLocation(target: string): Promise<number> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/locations`;
    const context = await request.newContext();
    const response = await context.post(url, {
      data: {
        type: "url",
        target,
      },
      headers: {
        "Content-Type": "application/json",
      },
    });
    return response.status();
  }

  /**
   * Fetches the ID of a location from the Backstage catalog by its target URL.
   *
   * @param target - The target URL of the location to search for.
   * @returns The ID string if found, otherwise undefined.
   */
  static async getLocationIdByTarget(target: string): Promise<string | undefined> {
    const baseUrl = process.env.BASE_URL;
    const url = `${baseUrl}/api/catalog/locations`;
    const context = await request.newContext();
    const response = await context.get(url);
    if (response.status() !== 200) {
      return undefined;
    }
    const data: unknown = await parseJsonResponse(response);
    if (!Array.isArray(data)) {
      return undefined;
    }
    const location = data.find(
      (entry): entry is CatalogLocationEntry =>
        isCatalogLocationEntry(entry) && entry.data?.target === target,
    );
    return location?.data?.id;
  }
}
