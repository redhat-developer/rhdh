import { defineConfig } from "@playwright/test";

import base from "./playwright.local.config";
import {
  backendWebServer,
  frontendWebServer,
  harnessProcessEnv,
  harnessReporters,
} from "./playwright/support/local-harness-servers";

/**
 * Cluster-free harness with api:app/app-language.defaultLanguage=fr and no
 * localStorage seeding. See docs/e2e-tests/default-language.md.
 *
 *   yarn --cwd e2e-tests e2e:local:default-language
 *
 * Spreads playwright.local.config.ts and overrides only what differs. Browser
 * locale stays English so French UI proves defaultLanguage (not the browser).
 * Do not reuse a server started by e2e:local (defaultLanguage en).
 */

process.env.LOCALE = "fr";
process.env.APP_DEFAULT_LANGUAGE = "fr";

const processEnv: Record<string, string> = {
  ...harnessProcessEnv,
  LOCALE: "fr",
  APP_DEFAULT_LANGUAGE: "fr",
};

export default defineConfig({
  ...base,
  testMatch: ["e2e/default-language.spec.ts"],
  // Dedicated allowlist — no @cluster-free-capable grep (that tag means the
  // spec also runs on a cluster deploy; this one cannot).
  grep: undefined,
  reporter: harnessReporters("local-default-language"),
  use: {
    ...base.use,
    // English browser locale: NFS ignores it; French must come from defaultLanguage.
    locale: "en",
  },
  webServer: [
    backendWebServer({ env: processEnv, reuseExistingServer: false }),
    frontendWebServer({ env: processEnv, reuseExistingServer: false }),
  ],
});
