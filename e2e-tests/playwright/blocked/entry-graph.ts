/**
 * Side-effect imports wiring blocked / future E2E specs into the static entry graph.
 */
/* oxlint-disable import/no-unassigned-import -- intentional side-effect graph wiring */

import { GetOrganizationResponse, ItemStatus } from "../support/api/github-structures";
import { RESOURCES } from "../support/test-data/resources";
import { TEMPLATES } from "../support/test-data/templates";
import * as githubApi from "../utils/api-helper/github";
import "../support/pages/rhdh-instance";
import "../utils/ui-helper/visibility";
void GetOrganizationResponse;
void RESOURCES;
void TEMPLATES;
void ItemStatus;
void ItemStatus.OPEN;
void ItemStatus.CLOSED;
void ItemStatus.ALL;
void githubApi.createGitHubRepo;
void githubApi.createFileInRepo;
void githubApi.createGitHubRepoWithFile;
void githubApi.initCommit;
void githubApi.deleteGitHubRepo;
void githubApi.mergeGitHubPR;
void githubApi.getfileContentFromPR;
