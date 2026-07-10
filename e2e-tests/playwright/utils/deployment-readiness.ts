/**
 * Staged deployment readiness: Available → HTTP /healthcheck → catalog synced.
 *
 * Callers pick which stages to run. Auth deploy uses all three; globalSetup
 * only needs HTTP once BASE_URL is an instance URL.
 */

export type DeploymentReadinessStage = "available" | "http" | "synced";

export type DeploymentReadinessDeps = {
  waitForAvailable: () => Promise<void>;
  waitForHttpReady: () => Promise<void>;
  waitForSynced: () => Promise<void>;
};

const STAGE_ORDER: DeploymentReadinessStage[] = ["available", "http", "synced"];

/**
 * Run readiness stages in fixed order, skipping stages not requested.
 */
export async function waitForDeploymentReadiness(
  stages: readonly DeploymentReadinessStage[],
  deps: DeploymentReadinessDeps,
): Promise<void> {
  const requested = new Set(stages);

  for (const stage of STAGE_ORDER) {
    if (!requested.has(stage)) {
      continue;
    }
    if (stage === "available") {
      await deps.waitForAvailable();
    } else if (stage === "http") {
      await deps.waitForHttpReady();
    } else {
      await deps.waitForSynced();
    }
  }
}
