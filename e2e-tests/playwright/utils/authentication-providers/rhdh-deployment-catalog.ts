import { GroupEntity } from "@backstage/catalog-model";

import { APIHelper } from "../api-helper";
import {
  getCatalogGroups,
  getCatalogUsers,
  isGroupEntity,
  isUserEntity,
  RHDHDeploymentState,
} from "./rhdh-deployment-types";

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

async function createCatalogApi(
  state: RHDHDeploymentState,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<APIHelper> {
  const api = new APIHelper();
  api.UseStaticToken(state.staticToken);
  api.UseBaseUrl(await computeBackstageBackendUrl());
  return api;
}

export async function checkUserIsIngestedInCatalog(
  state: RHDHDeploymentState,
  users: string[],
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const response: unknown = await api.getAllCatalogUsersFromAPI();
  const catalogUsers = getCatalogUsers(response);
  const { expect } = await import("@playwright/test");
  expect(catalogUsers.length).toBeGreaterThan(0);
  const catalogUsersDisplayNames: string[] = catalogUsers
    .map((u) => u.spec.profile?.displayName)
    .filter((name): name is string => name !== undefined);
  console.log(
    `Checking ${JSON.stringify(catalogUsersDisplayNames)} contains users ${JSON.stringify(users)}`,
  );
  return users.every((elem) => catalogUsersDisplayNames.includes(elem));
}

export async function checkGroupIsIngestedInCatalog(
  state: RHDHDeploymentState,
  groups: string[],
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const response: unknown = await api.getAllCatalogGroupsFromAPI();
  const catalogGroups = getCatalogGroups(response);
  const { expect } = await import("@playwright/test");
  expect(catalogGroups.length).toBeGreaterThan(0);
  const catalogGroupsDisplayNames: string[] = catalogGroups
    .map((u) => u.spec.profile?.displayName)
    .filter((name): name is string => name !== undefined);
  console.log(
    `Checking ${JSON.stringify(catalogGroupsDisplayNames)} contains groups ${JSON.stringify(groups)}`,
  );
  return groups.every((elem) => catalogGroupsDisplayNames.includes(elem));
}

export async function checkUserIsInGroup(
  state: RHDHDeploymentState,
  user: string,
  group: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const entity: unknown = await api.getGroupEntityFromAPI(group);
  if (!isGroupEntity(entity)) {
    throw new Error(`Invalid group entity for ${group}`);
  }
  const members = parseGroupMemberFromEntity(entity);
  console.log(`Checking group ${group} (${JSON.stringify(members)}) contains user ${user}`);
  return members.includes(user);
}

export async function checkGroupIsParentOfGroup(
  state: RHDHDeploymentState,
  parent: string,
  child: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const entity: unknown = await api.getGroupEntityFromAPI(parent);
  if (!isGroupEntity(entity)) {
    throw new Error(`Invalid group entity for ${parent}`);
  }
  const children = parseGroupChildrenFromEntity(entity);
  console.log(
    `Checking children of ${parent} (${JSON.stringify(children)}) contain group ${child}`,
  );
  return children.includes(child);
}

export async function checkGroupIsChildOfGroup(
  state: RHDHDeploymentState,
  child: string,
  parent: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const entity: unknown = await api.getGroupEntityFromAPI(child);
  if (!isGroupEntity(entity)) {
    throw new Error(`Invalid group entity for ${child}`);
  }
  const parents = parseGroupParentFromEntity(entity);
  console.log(`Checking parents of ${child} (${JSON.stringify(parents)}) contain group ${parent}`);
  return parents.includes(parent);
}

export async function checkUserHasAnnotation(
  state: RHDHDeploymentState,
  user: string,
  annotationKey: string,
  expectedValue: string,
  computeBackstageBackendUrl: () => Promise<string>,
): Promise<boolean> {
  const api = await createCatalogApi(state, computeBackstageBackendUrl);
  const entity: unknown = await api.getCatalogUserFromAPI(user);
  if (!isUserEntity(entity)) {
    throw new Error(`Invalid user entity for ${user}`);
  }
  const annotations = entity.metadata?.annotations ?? {};
  const actualValue = annotations[annotationKey];
  console.log(
    `Checking user ${user} has annotation ${annotationKey}=${expectedValue}, actual value: ${actualValue}`,
  );
  return actualValue === expectedValue;
}
