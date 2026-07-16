import { describe, expect, it, vi } from "vitest";

import { API_REQUEST_TIMEOUT_MS, CATALOG_API_TIMEOUT_MS } from "../playwright/utils/api-helper";
import { parseJsonResponse, type JsonHttpResponse } from "../playwright/utils/api-helper/guards";
import {
  CATALOG_INGESTION_POLL_TIMEOUT_MS,
  catalogDisplayNamesInclude,
} from "../playwright/utils/authentication-providers/rhdh-deployment/catalog";
import {
  getCatalogGroups,
  getCatalogUsers,
} from "../playwright/utils/authentication-providers/rhdh-deployment/types";

describe("catalogDisplayNamesInclude", () => {
  it("returns true when every expected name is present", () => {
    expect(
      catalogDisplayNamesInclude(
        ["Admin E2e", "Zeus Giove", "Atena Minerva"],
        ["Admin E2e", "Zeus Giove"],
      ),
    ).toBe(true);
  });

  it("returns false when any expected name is missing", () => {
    expect(catalogDisplayNamesInclude(["Admin E2e"], ["Admin E2e", "Zeus Giove"])).toBe(false);
  });
});

describe("catalog API budgets", () => {
  it("locks the shared API request timeout at 60s", () => {
    expect(API_REQUEST_TIMEOUT_MS).toBe(60_000);
    expect(CATALOG_API_TIMEOUT_MS).toBe(60_000);
  });

  it("locks ingestion poll budget at 120s", () => {
    expect(CATALOG_INGESTION_POLL_TIMEOUT_MS).toBe(120_000);
    expect(CATALOG_INGESTION_POLL_TIMEOUT_MS).toBeGreaterThan(API_REQUEST_TIMEOUT_MS);
  });
});

function mockJsonHttpResponse(partial: {
  ok: boolean;
  status: number;
  url: string;
  text?: string;
  json?: unknown;
}): { response: JsonHttpResponse; json: ReturnType<typeof vi.fn<() => Promise<unknown>>> } {
  const json = vi.fn<() => Promise<unknown>>().mockResolvedValue(partial.json);
  return {
    response: {
      ok: () => partial.ok,
      status: () => partial.status,
      url: () => partial.url,
      text: () => Promise.resolve(partial.text ?? ""),
      json,
    },
    json,
  };
}

describe("parseJsonResponse", () => {
  it("fails fast on non-2xx so polls do not burn the full timeout", async () => {
    const { response, json } = mockJsonHttpResponse({
      ok: false,
      status: 503,
      url: "https://example.test/api/catalog/entities/by-query",
      text: "backend not ready",
    });

    await expect(parseJsonResponse(response)).rejects.toThrow(/HTTP 503/u);
    expect(json).not.toHaveBeenCalled();
  });

  it("parses JSON when the response is ok", async () => {
    const { response } = mockJsonHttpResponse({
      ok: true,
      status: 200,
      url: "https://example.test/api/catalog/entities/by-query",
      json: { items: [] },
    });

    await expect(parseJsonResponse(response)).resolves.toEqual({ items: [] });
  });
});

describe("getCatalogUsers / getCatalogGroups", () => {
  it("treats an empty items list as not ingested yet", () => {
    expect(getCatalogUsers({ items: [] })).toEqual([]);
    expect(getCatalogGroups({ items: [] })).toEqual([]);
  });

  it("fails fast on missing items so polls do not burn the full timeout", () => {
    expect(() => getCatalogUsers({ error: "boom" })).toThrow(/Invalid catalog users response/u);
    expect(() => getCatalogGroups("not-json")).toThrow(/Invalid catalog groups response/u);
  });

  it("fails fast when items are the wrong entity kind", () => {
    expect(() => getCatalogUsers({ items: [{ kind: "Group" }] })).toThrow(/non-User/u);
    expect(() => getCatalogGroups({ items: [{ kind: "User" }] })).toThrow(/non-Group/u);
  });
});
