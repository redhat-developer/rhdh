/**
 * Playwright Project Names - Single Source of Truth
 *
 * The project names are defined in projects.json.
 * This file re-exports them as PW_PROJECT with proper TypeScript types.
 *
 * Used in:
 * - playwright.config.ts for project definitions
 * - CI/CD pipeline scripts (via .ibm/pipelines/playwright-projects.sh as PW_PROJECT_*)
 * - package.json scripts for local development
 */

import projectsJson from "./projects.json" with { type: "json" };

export const PW_PROJECT = projectsJson as {
  readonly SMOKE_TEST: string;
  readonly SHOWCASE: string;
  readonly SHOWCASE_RBAC: string;
  readonly ANY_TEST: string;
  readonly SHOWCASE_K8S: string;
  readonly SHOWCASE_RBAC_K8S: string;
  readonly SHOWCASE_OPERATOR: string;
  readonly SHOWCASE_OPERATOR_RBAC: string;
  readonly SHOWCASE_RUNTIME_DB: string;
  readonly SHOWCASE_RUNTIME: string;
  readonly SHOWCASE_AUTH_PROVIDERS: string;
  readonly SHOWCASE_SANITY_PLUGINS: string;
  readonly SHOWCASE_UPGRADE: string;
  readonly SHOWCASE_LOCALIZATION_FR: string;
  readonly SHOWCASE_LOCALIZATION_IT: string;
  readonly SHOWCASE_LOCALIZATION_JA: string;
};

// Type for project names
export type PlaywrightProjectName =
  (typeof PW_PROJECT)[keyof typeof PW_PROJECT];
