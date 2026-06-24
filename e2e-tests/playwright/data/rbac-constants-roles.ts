import { Role } from "../support/api/rbac-api-structures";

export const EXPECTED_ROLES: Role[] = [
  {
    memberReferences: ["user:default/rhdh-qe"],
    name: "role:default/rbac_admin",
  },
  {
    memberReferences: ["user:default/guest"],
    name: "role:default/guests",
  },
  {
    memberReferences: ["user:default/user_team_a", "user:default/rhdh-qe"],
    name: "role:default/team_a",
  },
  {
    memberReferences: ["user:xyz/user"],
    name: "role:xyz/team_a",
  },
  {
    memberReferences: ["group:default/rhdh-qe-2-team"],
    name: "role:default/test2-role",
  },
  {
    memberReferences: ["user:default/rhdh-qe"],
    name: "role:default/qe_rbac_admin",
  },
  {
    memberReferences: ["group:default/rhdh-qe-parent-team", "group:default/rhdh-qe-child-team"],
    name: "role:default/transitive-owner",
  },
  {
    memberReferences: ["user:default/rhdh-qe-5"],
    name: "role:default/kubernetes_reader",
  },
  {
    memberReferences: ["user:default/rhdh-qe-5", "user:default/rhdh-qe-6"],
    name: "role:default/catalog_reader",
  },
  {
    memberReferences: ["user:default/rhdh-qe-7", "user:default/rhdh-qe-9"],
    name: "role:default/all_resource_reader",
  },
  {
    memberReferences: ["user:default/rhdh-qe-8"],
    name: "role:default/all_resource_denier",
  },
  {
    memberReferences: ["user:default/rhdh-qe-7", "user:default/rhdh-qe-8"],
    name: "role:default/owned_resource_reader",
  },
  {
    memberReferences: ["user:default/rhdh-qe-9"],
    name: "role:default/conditional_denier",
  },
];
