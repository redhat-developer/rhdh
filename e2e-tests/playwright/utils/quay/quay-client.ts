export class QuayClient {
  apiUrl: string;
  token: string;
  headers: { "Content-Type": string; Accept: string; Authorization: string };

  constructor() {
    this.apiUrl = "https://quay.io/api/v1";
    this.token = process.env.QUAY_TOKEN;
    this.headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  async deleteRepository(namespace: string, repoName: string) {
    const url = `${this.apiUrl}/repository/${namespace}/${repoName}`;
    const response = await fetch(url, {
      headers: this.headers,
      method: "DELETE",
    });

    if (!response.ok) {
      throw new Error(
        `Failed to delete repository ${namespace}/${repoName}, error ${response.status}: ${await response.text()}`,
      );
    }
  }
}
