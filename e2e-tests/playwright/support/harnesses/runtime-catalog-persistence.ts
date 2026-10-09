import type { APIRequestContext, TestInfo } from "@playwright/test";
import type { Client } from "pg";

import { isRecord } from "../../utils/kube-client";
import { RUNTIME_CATALOG_URL } from "../../utils/runtime-catalog";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";
import { test, expect } from "../coverage/test";

interface CatalogRuntime {
  entityName: string;
  apiToken: string;
  databasePrefix: string;
  connect(database: string): Promise<Client>;
  restart(whileStopped?: () => Promise<void>): Promise<void>;
}

/** The same API identity and external SQL row must survive while RHDH is offline. */
export async function verifyCatalogPersistence(
  request: APIRequestContext,
  runtime: CatalogRuntime,
  info: Pick<TestInfo, "attach">,
): Promise<void> {
  const headers = { Authorization: `Bearer ${runtime.apiToken}` };
  const entityRef = `component:default/${runtime.entityName}`;
  const path = `/api/catalog/entities/by-name/component/default/${runtime.entityName}`;
  const database = `${runtime.databasePrefix}catalog`;
  const readEntity = async () => {
    // Read-only polling tolerates route resets while preserving the entity identity oracle.
    const response = await request
      .get(path, { headers, timeout: 10_000, maxRetries: 2 })
      .catch(() => null);
    if (response === null || response.status() === 404 || response.status() >= 500) return null;
    expect(response.status(), "Catalog entity request must be authorized").toBe(200);
    const entity: unknown = await response.json();
    if (
      !isRecord(entity) ||
      !isRecord(entity.metadata) ||
      typeof entity.metadata.uid !== "string" ||
      typeof entity.metadata.name !== "string" ||
      typeof entity.kind !== "string"
    ) {
      throw new Error("Catalog API did not return an entity identity");
    }
    return {
      kind: entity.kind,
      metadata: { name: entity.metadata.name, uid: entity.metadata.uid },
    };
  };
  const readRows = async () => {
    const client = await runtime.connect(database);
    try {
      return (
        await client.query<{ database: string; entity_id: string; entity_ref: string }>(
          "SELECT current_database() AS database, entity_id, entity_ref FROM final_entities WHERE entity_ref = $1",
          [entityRef],
        )
      ).rows;
    } finally {
      await client.end();
    }
  };

  const entity = await test.step("Write a unique catalog entity through RHDH", async () => {
    let reconcile = false;
    await expect
      .poll(
        async () => {
          if (reconcile) {
            // A lost reply may hide a committed write. Read its state before attempting another POST.
            const response = await request
              .get("/api/catalog/locations", { headers, timeout: 10_000, maxRetries: 2 })
              .catch(() => null);
            if (response === null || response.status() >= 500) return false;
            expect(response.status()).toBe(200);
            const locations: unknown = await response.json();
            if (!Array.isArray(locations)) throw new Error("Catalog location list is not an array");
            const matching = locations.filter(
              (item: unknown) =>
                isRecord(item) &&
                isRecord(item.data) &&
                item.data.type === "url" &&
                item.data.target === RUNTIME_CATALOG_URL,
            );
            if (matching.length > 0) {
              expect(matching).toHaveLength(1);
              return true;
            }
          }
          const response = await request
            .post("/api/catalog/locations", {
              headers,
              timeout: 10_000,
              data: { type: "url", target: RUNTIME_CATALOG_URL },
            })
            .catch(() => null);
          reconcile = response === null || response.status() === 409;
          if (reconcile) return false;
          expect(response!.status(), await response!.text()).toBe(201);
          return true;
        },
        { timeout: 120_000, intervals: [2_000] },
      )
      .toBe(true);
    let created: Awaited<ReturnType<typeof readEntity>> = null;
    await expect
      .poll(
        async () => {
          created = await readEntity();
          return created?.metadata.uid;
        },
        { timeout: 300_000 },
      )
      .toBeTruthy();
    expect(created).toMatchObject({ kind: "Component", metadata: { name: runtime.entityName } });
    return created!;
  });
  const expected = [{ database, entity_id: entity.metadata.uid, entity_ref: entityRef }];
  await test.step("Verify the entity identity in the external catalog database", async () => {
    expect(await readRows()).toEqual(expected);
  });
  await test.step("Retain the SQL entity while RHDH is fully stopped", async () => {
    await runtime.restart(async () => {
      const rows = await readRows();
      await info.attach("runtime-catalog-offline", {
        body: JSON.stringify(rows),
        contentType: "application/json",
      });
      expect(rows).toEqual(expected);
    });
  });
  await test.step("Read the same API and SQL identity after a fresh rollout", async () => {
    await waitForRhdhReady(request, 180_000);
    await expect
      .poll(async () => (await readEntity())?.metadata.uid, { timeout: 120_000 })
      .toBe(entity.metadata.uid);
    const rows = await readRows();
    expect(rows).toEqual(expected);
    await info.attach("runtime-catalog-persistence", {
      body: JSON.stringify({ before: expected, after: rows }),
      contentType: "application/json",
    });
  });
}
