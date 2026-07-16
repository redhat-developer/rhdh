import { type UserEntity } from "@backstage/catalog-model";

/** Minimal surface of Playwright APIResponse used by parseJsonResponse. */
export interface JsonHttpResponse {
  ok(): boolean;
  status(): number;
  url(): string;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

interface GitHubPullRequestFile {
  filename: string;
  raw_url: string;
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

export function isEntityMetadataResponse(value: unknown): value is EntityMetadataResponse {
  return typeof value === "object" && value !== null;
}

export function isCatalogLocationEntry(value: unknown): value is CatalogLocationEntry {
  return typeof value === "object" && value !== null;
}

export function isGitHubPullRequestFile(value: unknown): value is GitHubPullRequestFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "filename" in value &&
    typeof value.filename === "string" &&
    "raw_url" in value &&
    typeof value.raw_url === "string"
  );
}

export function isUserEntity(value: unknown): value is UserEntity {
  return isEntityMetadataResponse(value) && "kind" in value && value.kind === "User";
}

/**
 * Parse JSON from a successful response. Non-2xx fails immediately so callers
 * do not treat auth/proxy errors as "not ingested yet".
 */
export async function parseJsonResponse(response: JsonHttpResponse): Promise<unknown> {
  if (!response.ok()) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `HTTP ${String(response.status())} for ${response.url()}: ${body.slice(0, 200)}`,
    );
  }
  return response.json();
}

export function toUnknownArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`Expected array but got ${typeof value}: ${JSON.stringify(value)}`);
  }
  const items: unknown[] = [];
  for (const item of value) {
    items.push(item);
  }
  return items;
}

export type { CatalogLocationEntry, GitHubPullRequestFile };
