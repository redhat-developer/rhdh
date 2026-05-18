import { JANUS_ORG } from "../../utils/constants";
import { APIHelper } from "../../utils/api-helper";
import { GITHUB_API_ENDPOINTS } from "../../utils/api-endpoints";

// https://docs.github.com/en/rest?apiVersion=2022-11-28
export default class GithubApi {
  public async getReposFromOrg(org = JANUS_ORG) {
    return APIHelper.getGithubPaginatedRequest(
      GITHUB_API_ENDPOINTS.orgRepos(org),
    );
  }

  public async fileExistsInRepo(
    owner: string,
    repo: string,
    file: string,
  ): Promise<boolean> {
    const resp = await APIHelper.githubRequest(
      "GET",
      `${GITHUB_API_ENDPOINTS.contents(owner, repo)}/${file}`,
    );
    const status = resp.status();
    if (status === 403) {
      throw Error("You don't have permissions to see this path");
    }
    return [200, 302, 304].includes(status);
  }
}
