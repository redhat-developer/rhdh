import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { isRecord } from "../playwright/utils/kube-client/helpers";

/**
 * Seam: CI operator Backstage start CRs must pin empty flavours — the same
 * invariant OperatorInstallProfile owns for Playwright-generated CRs — so the
 * lightspeed flavour cannot reinject broken OCI pulls into nightlies.
 */
const operatorCrDir = join(import.meta.dirname, "../../.ci/pipelines/resources/rhdh-operator");

interface BackstageCrDoc {
  kind: "Backstage";
  spec: { flavours?: unknown };
}

function isBackstageCrDoc(value: unknown): value is BackstageCrDoc {
  if (!isRecord(value) || value.kind !== "Backstage" || !isRecord(value.spec)) {
    return false;
  }
  return true;
}

function listOperatorStartCrFiles(): string[] {
  return readdirSync(operatorCrDir)
    .filter((name) => name.startsWith("rhdh-start") && name.endsWith(".yaml"))
    .map((name) => join(operatorCrDir, name));
}

describe("CI operator start Backstage CRs", () => {
  it("declares flavours: [] on every rhdh-start*.yaml", () => {
    const files = listOperatorStartCrFiles();
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const doc: unknown = parseYaml(readFileSync(file, "utf8"));
      expect(isBackstageCrDoc(doc), `Backstage doc missing in ${file}`).toBe(true);
      if (!isBackstageCrDoc(doc)) {
        return;
      }
      expect(doc.spec.flavours, `${file} must pin flavours: []`).toEqual([]);
    }
  });
});
