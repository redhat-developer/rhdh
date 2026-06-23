export class GetOrganizationResponse {
  reposUrl: string;

  constructor(response: unknown) {
    if (
      typeof response !== "object" ||
      response === null ||
      !("repos_url" in response)
    ) {
      throw new Error("Invalid GitHub organization response");
    }

    const reposUrl = (response as { repos_url: unknown }).repos_url;
    if (typeof reposUrl !== "string") {
      throw new TypeError(
        "Invalid GitHub organization response: missing repos_url",
      );
    }

    this.reposUrl = reposUrl;
  }
}

export enum ItemStatus {
  OPEN = "open",
  CLOSED = "closed",
  ALL = "all",
}
