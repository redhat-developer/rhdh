import { type UserEntity } from "@backstage/catalog-model";
import { type APIResponse } from "@playwright/test";

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

export function parseJsonResponse(response: APIResponse): Promise<unknown> {
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
