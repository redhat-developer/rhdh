import { describe, expect, it } from "vitest";

import { buildImageRef } from "../playwright/utils/helper";
import {
  generateAppConfigYaml,
  generateBackstageCR,
  generateDynamicPluginsYaml,
} from "../playwright/utils/runtime-config";

describe("operator runtime config", () => {
  it("wires BACKEND_SECRET into app-config keys and externalAccess", () => {
    const yamlText = generateAppConfigYaml("https://example.test");
    expect(yamlText).toContain("secret: ${BACKEND_SECRET}");
    expect(yamlText).toMatch(/keys:[\s\S]*secret: \$\{BACKEND_SECRET\}/u);
  });

  it("enables the dynamic homepage plugin", () => {
    const yamlText = generateDynamicPluginsYaml();
    expect(yamlText).toContain("red-hat-developer-hub-backstage-plugin-dynamic-home-page");
    expect(yamlText).toContain("DynamicHomePage");
    expect(yamlText).not.toMatch(/plugins:\s*\[\]/u);
    expect(yamlText).toContain("includes: []");
  });

  it("injects BACKEND_SECRET into the Backstage CR env", () => {
    const cr = generateBackstageCR({
      releaseName: "rhdh",
      namespace: "showcase-runtime",
      routerBase: "apps.example.com",
      image: buildImageRef("quay.io", "rhdh/rhdh-hub-rhel9", "next"),
    });
    const serialized = JSON.stringify(cr);
    expect(serialized).toContain('"name":"BACKEND_SECRET"');
    expect(serialized).toContain('"value":"super-secret-for-tests"');
    expect(cr.spec.flavours).toEqual([]);
    expect(cr.apiVersion).toBe("rhdh.redhat.com/v1alpha5");
  });
});
