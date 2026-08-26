/**
 * Operator install invariants shared by runtime and auth-provider adapters.
 *
 * Owns CR apiVersion, empty flavours, BACKEND_SECRET wiring, and operator
 * app-config auth-key policy so install methods cannot drift.
 */

export const BACKSTAGE_CR_API_VERSION = "rhdh.redhat.com/v1alpha5";

/** Stable test secret — mirrors the Helm chart's BACKEND_SECRET default. */
export const OPERATOR_BACKEND_SECRET = "super-secret-for-tests";

export type OperatorInstallKind = "runtime" | "auth-providers";

export type YamlRecord = Record<string, unknown>;

export interface BackstageCrLike {
  apiVersion: string;
  kind: string;
  metadata: { name: string; [key: string]: unknown };
  spec: YamlRecord;
}

function isRecord(value: unknown): value is YamlRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ensureRecord(parent: YamlRecord, key: string): YamlRecord {
  const existing = parent[key];
  if (isRecord(existing)) {
    return existing;
  }
  const created: YamlRecord = {};
  parent[key] = created;
  return created;
}

function ensureEnvList(extraEnvs: YamlRecord): YamlRecord[] {
  const existing = extraEnvs.envs;
  if (Array.isArray(existing) && existing.every((item) => isRecord(item))) {
    return existing;
  }
  const created: YamlRecord[] = [];
  extraEnvs.envs = created;
  return created;
}

function upsertEnv(envs: YamlRecord[], name: string, value: string): void {
  const existing = envs.find((env) => env.name === name);
  if (existing !== undefined) {
    existing.value = value;
    return;
  }
  envs.push({ name, value });
}

/**
 * Apply shared operator CR invariants (apiVersion, flavours, BACKEND_SECRET).
 */
export function applyOperatorInstallProfileToCr(cr: BackstageCrLike): BackstageCrLike {
  cr.apiVersion = BACKSTAGE_CR_API_VERSION;
  cr.spec.flavours = [];

  const application = ensureRecord(cr.spec, "application");
  const extraEnvs = ensureRecord(application, "extraEnvs");
  const envs = ensureEnvList(extraEnvs);
  upsertEnv(envs, "BACKEND_SECRET", OPERATOR_BACKEND_SECRET);

  return cr;
}

/**
 * Apply shared operator app-config invariants.
 *
 * Auth-providers fixtures historically used a hardcoded key and sqlite; on
 * cluster the operator provisions Postgres and readiness needs ${BACKEND_SECRET}.
 */
export function applyOperatorInstallProfileToAppConfig(
  appConfig: YamlRecord,
  kind: OperatorInstallKind,
): void {
  const backend = ensureRecord(appConfig, "backend");
  const auth = ensureRecord(backend, "auth");
  auth.keys = [{ secret: "${BACKEND_SECRET}" }];

  if (kind === "auth-providers" && "database" in backend) {
    delete backend.database;
  }
}
