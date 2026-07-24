/**
 * Staged deployment readiness: Deployment created → HTTP /healthcheck → catalog synced.
 *
 * "created" waits only until the Deployment object exists — not K8s Available —
 * so HTTP can fail fast on 503 instead of burning the Available timeout first.
 */

export type DeploymentReadinessStage = "created" | "http" | "synced";

export type DeploymentReadinessDeps = {
  waitForCreated: () => Promise<void>;
  waitForHttpReady: () => Promise<void>;
  waitForSynced: () => Promise<void>;
};

const STAGE_ORDER: DeploymentReadinessStage[] = ["created", "http", "synced"];

const STAGE_RUNNERS: Record<
  DeploymentReadinessStage,
  (deps: DeploymentReadinessDeps) => Promise<void>
> = {
  created: (deps) => deps.waitForCreated(),
  http: (deps) => deps.waitForHttpReady(),
  synced: (deps) => deps.waitForSynced(),
};

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
    await STAGE_RUNNERS[stage](deps);
  }
}
