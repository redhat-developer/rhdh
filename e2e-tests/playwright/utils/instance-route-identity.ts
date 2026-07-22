/**
 * Single source of truth for RHDH instance route and deployment naming.
 *
 * Helm and operator install methods use different route / Deployment names.
 * Callers (runtime deploy early-exit, CI predicted URLs, auth operator URL)
 * must not invent parallel formulas.
 */

export type InstallMethod = "helm" | "operator";

export type InstanceRouteIdentity = {
  installMethod: InstallMethod;
  releaseName: string;
  namespace: string;
  /** OpenShift router base, e.g. `apps.cluster.example.com`. */
  routerBase: string;
};

export type InstanceRouteIdentityEnv = Record<string, string | undefined>;

const DEFAULT_RELEASE_NAME = "rhdh";
const DEFAULT_RUNTIME_NAMESPACE = "showcase-runtime";

export function resolveReleaseName(env: InstanceRouteIdentityEnv = process.env): string {
  const releaseName = env.RELEASE_NAME?.trim();
  return releaseName !== undefined && releaseName !== "" ? releaseName : DEFAULT_RELEASE_NAME;
}

export function resolveRuntimeNamespace(env: InstanceRouteIdentityEnv = process.env): string {
  const namespace = env.NAME_SPACE_RUNTIME?.trim();
  return namespace !== undefined && namespace !== "" ? namespace : DEFAULT_RUNTIME_NAMESPACE;
}

/**
 * OpenShift Route object name for the Backstage frontend.
 * Helm chart: `<release>-developer-hub` (or the release itself if already suffixed).
 * Operator: `backstage-<release>`.
 */
export function routeObjectName(installMethod: InstallMethod, releaseName: string): string {
  if (installMethod === "operator") {
    return `backstage-${releaseName}`;
  }
  return releaseName.includes("developer-hub") ? releaseName : `${releaseName}-developer-hub`;
}

/**
 * Kubernetes Deployment name for the Backstage workload.
 * Helm: `<release>-developer-hub`. Operator: `backstage-<release>`.
 */
export function deploymentName(installMethod: InstallMethod, releaseName: string): string {
  return installMethod === "operator" ? `backstage-${releaseName}` : `${releaseName}-developer-hub`;
}

/** Predicted OpenShift route hostname (no scheme). */
export function predictedHostname(identity: InstanceRouteIdentity): string {
  const route = routeObjectName(identity.installMethod, identity.releaseName);
  return `${route}-${identity.namespace}.${identity.routerBase}`;
}

/** Predicted https URL for the instance. */
export function predictedUrl(identity: InstanceRouteIdentity): string {
  return `https://${predictedHostname(identity)}`;
}

export function createInstanceRouteIdentity(
  installMethod: InstallMethod,
  releaseName: string,
  namespace: string,
  routerBase: string,
): InstanceRouteIdentity {
  return { installMethod, releaseName, namespace, routerBase };
}

/**
 * Build identity for the showcase-runtime deployment from env + router base.
 */
export function runtimeInstanceRouteIdentity(
  installMethod: InstallMethod,
  routerBase: string,
  env: InstanceRouteIdentityEnv = process.env,
): InstanceRouteIdentity {
  return createInstanceRouteIdentity(
    installMethod,
    resolveReleaseName(env),
    resolveRuntimeNamespace(env),
    routerBase,
  );
}

/**
 * True when `baseUrl` is the predicted URL for the runtime instance under
 * the current env (defense against RUNTIME_AUTO_DEPLOY leaking across projects).
 */
export function isPredictedRuntimeUrl(
  baseUrl: string,
  installMethod: InstallMethod,
  routerBase: string,
  env: InstanceRouteIdentityEnv = process.env,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    return false;
  }

  const expected = predictedHostname(runtimeInstanceRouteIdentity(installMethod, routerBase, env));
  return parsed.hostname.toLowerCase() === expected.toLowerCase();
}
