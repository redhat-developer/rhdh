import { scaffolderSelfServiceModule } from ".";

describe("scaffolderSelfServiceModule", () => {
  it("targets the scaffolder plugin id", () => {
    expect(scaffolderSelfServiceModule.pluginId).toBe("scaffolder");
    expect(scaffolderSelfServiceModule.$$type).toBe(
      "@backstage/FrontendModule",
    );
  });
});
