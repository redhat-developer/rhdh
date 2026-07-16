import { GroupEntity } from "@backstage/catalog-model";

import { APIHelper } from "../../api-helper";
import {
  getCatalogGroups,
  getCatalogUsers,
  isGroupEntity,
  isUserEntity,
  RHDHDeploymentState,
} from "./types";

/** Poll budget for Keycloak/OIDC entities to appear after provider sync. */
export const CATALOG_INGESTION_POLL_TIMEOUT_MS = 120_000;

export function parseGroupMemberFromEntity(group: GroupEntity): string[] {
  if (group.relations === undefined) {
    return [];
  }
  return group.relations
    .filter((r) => r.type === "hasMember")
    .map((r) => r.targetRef.split("/")[1]);
}

export function parseGroupChildrenFromEntity(group: GroupEntity): string[] {
  if (group.relations === undefined) {
    return [];
  }
  return group.relations.filter((r) => r.type === "parentOf").map((r) => r.targetRef.split("/")[1]);
}

export function parseGroupParentFromEntity(group: GroupEntity): string[] {
  if (group.relations === undefined) {
    return [];
  }
  return group.relations.filter((r) => r.type === "childOf").map((r) => r.targetRef.split("/")[1]);
}

/**
 * Pure predicate for ingestion checks — kept free of I/O so unit tests can
 * lock the displayName matching rule without a live catalog.
 */
export function catalogDisplayNamesInclude(
  displayNames: readonly string[],
  expected: readonly string[],
): boolean {
  return expected.every((elem) => displayNames.includes(elem));
}

async function createCatalogApi(
  state: RHDHDeploymentState,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<APIHelper> {
  const api = new APIHelper();
  api.UseStaticToken(state.staticToken);
  api.UseBaseUrl(await computeBackstageBackendUrl());
  return api;
}

async function pollUntilTrue(check: () => Promise<boolean>, label: string): Promise<boolean> {
  const { expect } = await import("@playwright/test");
  await expect
    .poll(check, {
      timeout: CATALOG_INGESTION_POLL_TIMEOUT_MS,
      intervals: [2_000, 5_000, 10_000],
      message: label,
    })
    .toBe(true);
  return true;
}

export function checkUserIsIngestedInCatalog(
  state: RHDHDeploymentState,
  users: string[],
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(
    async () => {
      const api = await createCatalogApi(state, computeBackstageBackendUrl);
      const response: unknown = await api.getAllCatalogUsersFromAPI();
      const catalogUsers = getCatalogUsers(response);
      if (catalogUsers.length === 0) {
        return false;
      }
      const catalogUsersDisplayNames: string[] = catalogUsers
        .map((u) => u.spec.profile?.displayName)
        .filter((name): name is string => name !== undefined);
      console.log(
        `Checking ${JSON.stringify(catalogUsersDisplayNames)} contains users ${JSON.stringify(users)}`,
      );
      return catalogDisplayNamesInclude(catalogUsersDisplayNames, users);
    },
    `catalog users include ${JSON.stringify(users)}`,
  );
}

export function checkGroupIsIngestedInCatalog(
  state: RHDHDeploymentState,
  groups: string[],
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(
    async () => {
      const api = await createCatalogApi(state, computeBackstageBackendUrl);
      const response: unknown = await api.getAllCatalogGroupsFromAPI();
      const catalogGroups = getCatalogGroups(response);
      if (catalogGroups.length === 0) {
        return false;
      }
      const catalogGroupsDisplayNames: string[] = catalogGroups
        .map((u) => u.spec.profile?.displayName)
        .filter((name): name is string => name !== undefined);
      console.log(
        `Checking ${JSON.stringify(catalogGroupsDisplayNames)} contains groups ${JSON.stringify(groups)}`,
      );
      return catalogDisplayNamesInclude(catalogGroupsDisplayNames, groups);
    },
    `catalog groups include ${JSON.stringify(groups)}`,
  );
}

export function checkUserIsInGroup(
  state: RHDHDeploymentState,
  user: string,
  group: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(async () => {
    const api = await createCatalogApi(state, computeBackstageBackendUrl);
    const entity: unknown = await api.getGroupEntityFromAPI(group);
    if (!isGroupEntity(entity)) {
      return false;
    }
    const members = parseGroupMemberFromEntity(entity);
    console.log(`Checking group ${group} (${JSON.stringify(members)}) contains user ${user}`);
    return members.includes(user);
  }, `group ${group} contains user ${user}`);
}

export function checkGroupIsParentOfGroup(
  state: RHDHDeploymentState,
  parent: string,
  child: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(async () => {
    const api = await createCatalogApi(state, computeBackstageBackendUrl);
    const entity: unknown = await api.getGroupEntityFromAPI(parent);
    if (!isGroupEntity(entity)) {
      return false;
    }
    const children = parseGroupChildrenFromEntity(entity);
    console.log(`Checking group ${parent} (${JSON.stringify(children)}) is parent of ${child}`);
    return children.includes(child);
  }, `group ${parent} is parent of ${child}`);
}

export function checkGroupIsChildOfGroup(
  state: RHDHDeploymentState,
  child: string,
  parent: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(async () => {
    const api = await createCatalogApi(state, computeBackstageBackendUrl);
    const entity: unknown = await api.getGroupEntityFromAPI(child);
    if (!isGroupEntity(entity)) {
      return false;
    }
    const parents = parseGroupParentFromEntity(entity);
    console.log(`Checking group ${child} (${JSON.stringify(parents)}) is child of ${parent}`);
    return parents.includes(parent);
  }, `group ${child} is child of ${parent}`);
}

export function checkUserHasAnnotation(
  state: RHDHDeploymentState,
  user: string,
  annotationKey: string,
  expectedValue: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  return pollUntilTrue(async () => {
    const api = await createCatalogApi(state, computeBackstageBackendUrl);
    const entity: unknown = await api.getCatalogUserFromAPI(user);
    if (!isUserEntity(entity)) {
      return false;
    }
    const actualValue = entity.metadata.annotations?.[annotationKey];
    console.log(
      `Checking user ${user} has annotation ${annotationKey}=${expectedValue}, actual value: ${actualValue}`,
    );
    return actualValue === expectedValue;
  }, `user ${user} has annotation ${annotationKey}=${expectedValue}`);
}
