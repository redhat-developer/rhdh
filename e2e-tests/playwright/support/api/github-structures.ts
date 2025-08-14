export class GetOrganizationResponse {
  reposUrl: string;

  constructor(response: unknown) {
    enum OrganizationResponseAttributes {
      REPOS_URL = "repos_url",
    }
    this.reposUrl = response[OrganizationResponseAttributes.REPOS_URL];
  }
}

export enum ItemStatus {
  OPEN = "open",
  CLOSED = "closed",
  ALL = "all",
}
