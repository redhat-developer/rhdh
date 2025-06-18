import { expect } from "@playwright/test";
import { APIHelper } from "./api-helper";

type EntityWithDisplay = { spec?: { profile?: { displayName?: string } } };

export class CatalogVerifier {
  private api: APIHelper;

  constructor(token: string) {
    this.api = new APIHelper();
    this.api.UseStaticToken(token);
  }

  async assertUsersInCatalog(expected: string[]): Promise<void> {
    await this.assertEntities(
      () => this.api.getAllCatalogUsersFromAPI(),
      expected,
      'users',
    );
  }

  async assertGroupsInCatalog(expected: string[]): Promise<void> {
    await this.assertEntities(
      () => this.api.getAllCatalogGroupsFromAPI(),
      expected,
      'groups',
    );
  }

  private async assertEntities(
    fetch: () => Promise<{ items?: EntityWithDisplay[] }>,
    expected: string[],
    label: string,
  ): Promise<void> {
    const { items = [] } = await fetch();

    expect(items.length).toBeGreaterThan(0);

    const displayNames = items
      .flatMap(e => e.spec?.profile?.displayName ?? []);

    const catalogSet = new Set(displayNames);
    const missing = expected.filter(name => !catalogSet.has(name));

    console.info(
      `Catalog ${label}: [${displayNames.join(', ')}] – expecting [${expected.join(', ')}]`,
    );

    expect(missing, `Missing ${label}: ${missing.join(', ')}`).toHaveLength(0);
  }
} 