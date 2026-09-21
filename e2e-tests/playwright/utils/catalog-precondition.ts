import { request } from "@playwright/test";

const showcaseEntityPath =
  "/api/catalog/entities/by-name/component/default/red-hat-developer-hub";
const locationsQuery = "/api/catalog/entities/by-query?filter=kind%3Dlocation";
const pollIntervalMs = 5000;
const refreshIntervalMs = 30000;

async function guestAuthHeaders(): Promise<Record<string, string>> {
  const ctx = await request.newContext();
  const response = await ctx.post("/api/auth/guest/refresh");
  if (!response.ok()) {
    throw new Error(
      `Guest auth refresh failed with status ${response.status()}`,
    );
  }
  const data = await response.json();
  return { Authorization: `Bearer ${data.backstageIdentity.token}` };
}

/**
 * Ensure the showcase entity the TechDocs/Quay/redis-cache suites depend on
 * is present in the catalog before any test runs.
 *
 * CI runs with catalog.processingInterval set to 24h, so a single transient
 * fetch failure while ingesting catalog-entities/all.yaml leaves
 * component:default/red-hat-developer-hub absent for the entire job and every
 * dependent test fails identically on all retries (RHIDP evidence: 7 tests,
 * 3 attempts each, byte-identical failure snapshots). The catalog refresh
 * endpoint bypasses the processing interval, so when the entity is missing we
 * ask the catalog to reprocess the location that carries it and poll.
 */
export async function ensureShowcaseEntityIngested(
  timeoutMs = 180000,
): Promise<void> {
  const headers = await guestAuthHeaders();
  const ctx = await request.newContext();
  const deadline = Date.now() + timeoutMs;
  let lastRefreshAt = 0;
  let lastStatus = 0;

  for (;;) {
    const response = await ctx.get(showcaseEntityPath, { headers });
    lastStatus = response.status();
    if (lastStatus === 200) {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `component:default/red-hat-developer-hub never appeared in the catalog ` +
          `within ${timeoutMs / 1000}s (last status: ${lastStatus}). With ` +
          `processingInterval 24h a transient ingestion failure leaves it ` +
          `absent for the whole job; the triggered refresh did not recover it.`,
      );
    }
    if (Date.now() - lastRefreshAt >= refreshIntervalMs) {
      await triggerLocationRefresh(ctx, headers);
      lastRefreshAt = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function triggerLocationRefresh(
  ctx: Awaited<ReturnType<typeof request.newContext>>,
  headers: Record<string, string>,
): Promise<void> {
  const locations = await ctx.get(locationsQuery, { headers });
  if (!locations.ok()) {
    console.warn(
      `Could not list catalog locations (status ${locations.status()}); skipping refresh trigger`,
    );
    return;
  }
  const body = (await locations.json()) as {
    items?: Array<{
      metadata?: { name?: string; namespace?: string };
      spec?: { target?: string };
    }>;
  };
  const location = (body.items ?? []).find((entity) =>
    String(entity.spec?.target ?? "").includes("catalog-entities/all.yaml"),
  );
  if (!location?.metadata?.name) {
    console.warn(
      "No catalog location targeting catalog-entities/all.yaml found; cannot trigger a refresh",
    );
    return;
  }
  const entityRef = `location:${location.metadata.namespace ?? "default"}/${location.metadata.name}`;
  const refresh = await ctx.post("/api/catalog/refresh", {
    headers,
    data: { entityRef },
  });
  console.warn(
    `red-hat-developer-hub missing from the catalog; triggered refresh of ${entityRef} (status ${refresh.status()})`,
  );
}
