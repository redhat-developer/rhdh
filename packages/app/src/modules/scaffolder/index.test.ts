import { rhdhScaffolderPlugin } from ".";

describe("rhdhScaffolderPlugin", () => {
  it("keeps the upstream scaffolder plugin id", () => {
    expect(rhdhScaffolderPlugin.id).toBe("scaffolder");
  });

  it("registers page:scaffolder", () => {
    expect(rhdhScaffolderPlugin.getExtension("page:scaffolder")).toBeDefined();
  });

  it("uses Self-service as the plugin title", () => {
    expect(rhdhScaffolderPlugin.title).toBe("Self-service");
  });
});
