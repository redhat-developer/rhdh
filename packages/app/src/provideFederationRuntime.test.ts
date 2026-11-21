describe("provideExternalFederationRuntime", () => {
  const key = "_FEDERATION_RUNTIME_CORE" as const;
  const fromKey = "_FEDERATION_RUNTIME_CORE_FROM" as const;

  afterEach(() => {
    delete (globalThis as Record<string, unknown>)[key];
    delete (globalThis as Record<string, unknown>)[fromKey];
    jest.resetModules();
  });

  it("assigns runtime-core to globalThis for externalized remotes", async () => {
    const { provideExternalFederationRuntime } = await import(
      "./provideFederationRuntime"
    );
    provideExternalFederationRuntime();

    const g = globalThis as Record<string, unknown>;
    expect(g[key]).toBeTruthy();
    expect(g[fromKey]).toEqual({
      name: "app",
      version: "provided-by-rhdh",
    });
  });

  it("does not overwrite an existing host-provided runtime", async () => {
    const sentinel = { already: true };
    (globalThis as Record<string, unknown>)[key] = sentinel;

    const { provideExternalFederationRuntime } = await import(
      "./provideFederationRuntime"
    );
    provideExternalFederationRuntime();

    expect((globalThis as Record<string, unknown>)[key]).toBe(sentinel);
  });
});
