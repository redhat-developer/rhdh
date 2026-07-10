import { describe, expect, it } from "vitest";

import {
  applyDynamicPluginsProfile,
  createRuntimeDynamicPluginsProfile,
  setPluginEnabled,
} from "../playwright/utils/dynamic-plugins-profile";

describe("DynamicPluginsProfile", () => {
  it("forces includes to an empty list so operator defaults cannot return", () => {
    const config = applyDynamicPluginsProfile({
      includes: ["dynamic-plugins.default.yaml"],
      plugins: [{ package: "pkg-a", enabled: false }],
    });

    expect(config.includes).toEqual([]);
  });

  it("enables a plugin via enabled and clears conflicting disabled", () => {
    const config = {
      includes: [] as string[],
      plugins: [{ package: "pkg-a", enabled: false, disabled: true }],
    };

    setPluginEnabled(config, "pkg-a", true);

    expect(config.plugins[0]).toMatchObject({ package: "pkg-a", enabled: true });
    expect(config.plugins[0].disabled).toBeUndefined();
  });

  it("adds a missing plugin when enabling", () => {
    const config = { includes: [] as string[], plugins: [] as Array<{ package: string }> };

    setPluginEnabled(config, "pkg-new", true);

    expect(config.plugins).toEqual([{ package: "pkg-new", enabled: true }]);
  });

  it("builds the runtime homepage profile with includes empty", () => {
    const profile = createRuntimeDynamicPluginsProfile();

    expect(profile.includes).toEqual([]);
    expect(profile.plugins[0]?.package).toContain("dynamic-home-page");
    expect(profile.plugins[0]?.enabled).toBe(true);
  });
});
