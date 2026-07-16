import { describe, expect, it } from "vitest";

import { CATALOG_API_TIMEOUT_MS } from "../playwright/utils/api-helper";
import {
  CATALOG_INGESTION_POLL_TIMEOUT_MS,
  catalogDisplayNamesInclude,
} from "../playwright/utils/authentication-providers/rhdh-deployment/catalog";

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
  it("uses a per-request timeout above Playwright's 10s default", () => {
    expect(CATALOG_API_TIMEOUT_MS).toBeGreaterThan(10_000);
  });

  it("polls ingestion longer than a single request timeout", () => {
    expect(CATALOG_INGESTION_POLL_TIMEOUT_MS).toBeGreaterThan(CATALOG_API_TIMEOUT_MS);
  });
});
