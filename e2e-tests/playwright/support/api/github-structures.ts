export class GetOrganizationResponse {
  reposUrl: string;

  constructor(response: unknown) {
    enum OrganizationResponseAttributes {
      REPOS_URL = "repos_url",
    }
    const data = response as Record<string, string>;
    this.reposUrl = data[OrganizationResponseAttributes.REPOS_URL];
  }
}

export enum ItemStatus {
  OPEN = "open",
  CLOSED = "closed",
  ALL = "all",
}
