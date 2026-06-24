import { type GroupEntity, type UserEntity } from "@backstage/catalog-model";
import { type APIResponse } from "@playwright/test";

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

export function isGuestTokenResponse(value: unknown): value is GuestTokenResponse {
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

export function isEntityMetadataResponse(value: unknown): value is EntityMetadataResponse {
  return typeof value === "object" && value !== null;
}

export function isCatalogLocationEntry(value: unknown): value is CatalogLocationEntry {
  return typeof value === "object" && value !== null;
}

export function isUserEntity(value: unknown): value is UserEntity {
  return isEntityMetadataResponse(value) && "kind" in value && value.kind === "User";
}

export function isGroupEntity(value: unknown): value is GroupEntity {
  return isEntityMetadataResponse(value) && "kind" in value && value.kind === "Group";
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

export type { GitHubPullRequestFile, CatalogLocationEntry };
