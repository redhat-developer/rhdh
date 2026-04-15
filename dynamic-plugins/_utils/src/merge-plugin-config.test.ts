import { mergePluginConfig } from "./merge-plugin-config";

describe("mergePluginConfig", () => {
  it("copies scalar keys from source when destination is empty", () => {
    const destination = {};
    mergePluginConfig({ a: 1, b: "foo" }, destination);
    expect(destination).toEqual({ a: 1, b: "foo" });
  });

  it("deep-merges non-duration sibling keys", () => {
    const destination: Record<string, unknown> = { a: { b: 1 } };
    mergePluginConfig({ a: { c: 2 } }, destination);
    expect(destination).toEqual({ a: { b: 1, c: 2 } });
  });

  it("throws when a scalar key is defined with different values", () => {
    const destination = { a: 1 };
    expect(() => mergePluginConfig({ a: 2 }, destination)).toThrow(
      "Config key 'a' defined differently for 2 dynamic plugins",
    );
  });

  it("includes the full path in the collision error", () => {
    const destination = { outer: { inner: { leaf: 1 } } };
    expect(() =>
      mergePluginConfig({ outer: { inner: { leaf: 2 } } }, destination),
    ).toThrow(
      "Config key 'outer.inner.leaf' defined differently for 2 dynamic plugins",
    );
  });

  it("does not throw when a scalar key is defined with the same value", () => {
    const destination = { a: 1 };
    mergePluginConfig({ a: 1 }, destination);
    expect(destination).toEqual({ a: 1 });
  });

  it("throws when destination has a scalar and source has a dict at the same key", () => {
    const destination: Record<string, unknown> = { outer: 1 };
    expect(() =>
      mergePluginConfig({ outer: { inner: 2 } }, destination),
    ).toThrow(
      "Config key 'outer' defined differently for 2 dynamic plugins",
    );
  });

  it("treats arrays as scalars and throws on array collision", () => {
    const destination: Record<string, unknown> = { locations: [1, 2] };
    expect(() =>
      mergePluginConfig({ locations: [3] }, destination),
    ).toThrow(
      "Config key 'locations' defined differently for 2 dynamic plugins",
    );
  });

  describe("replace-semantics for schedule duration subtrees", () => {
    it("replaces schedule.frequency rather than combining sibling duration keys (RHDHBUGS-2139)", () => {
      const destination = {
        catalog: {
          providers: {
            keycloakOrg: {
              default: {
                schedule: {
                  frequency: { minutes: 60 },
                  initialDelay: { seconds: 15 },
                  timeout: { minutes: 50 },
                },
              },
            },
          },
        },
      };

      mergePluginConfig(
        {
          catalog: {
            providers: {
              keycloakOrg: {
                default: {
                  schedule: { frequency: { seconds: 30 } },
                },
              },
            },
          },
        },
        destination,
      );

      // Frequency is replaced entirely — no leaked minutes: 60.
      expect(
        destination.catalog.providers.keycloakOrg.default.schedule.frequency,
      ).toEqual({ seconds: 30 });
      // Other schedule subtrees are untouched because the user did not set them.
      expect(
        destination.catalog.providers.keycloakOrg.default.schedule
          .initialDelay,
      ).toEqual({ seconds: 15 });
      expect(
        destination.catalog.providers.keycloakOrg.default.schedule.timeout,
      ).toEqual({ minutes: 50 });
    });

    it("replaces schedule.timeout", () => {
      const destination = {
        schedule: { timeout: { minutes: 50 } },
      };
      mergePluginConfig(
        { schedule: { timeout: { seconds: 5 } } },
        destination,
      );
      expect(destination.schedule.timeout).toEqual({ seconds: 5 });
    });

    it("replaces schedule.initialDelay", () => {
      const destination = {
        schedule: { initialDelay: { seconds: 15 } },
      };
      mergePluginConfig(
        { schedule: { initialDelay: { minutes: 1 } } },
        destination,
      );
      expect(destination.schedule.initialDelay).toEqual({ minutes: 1 });
    });

    it("applies regular deep-merge to a 'frequency' key outside a schedule subtree", () => {
      const destination = {
        metrics: { frequency: { minutes: 10 } },
      };
      mergePluginConfig(
        { metrics: { frequency: { seconds: 5 } } },
        destination,
      );
      expect(destination.metrics.frequency).toEqual({
        minutes: 10,
        seconds: 5,
      });
    });

    it("is a no-op when both sides have the same duration value", () => {
      const destination = { schedule: { frequency: { minutes: 60 } } };
      mergePluginConfig(
        { schedule: { frequency: { minutes: 60 } } },
        destination,
      );
      expect(destination.schedule.frequency).toEqual({ minutes: 60 });
    });

    it("replaces all three duration subtrees in a single merge call", () => {
      const destination = {
        schedule: {
          frequency: { minutes: 60 },
          initialDelay: { seconds: 15 },
          timeout: { minutes: 50 },
        },
      };
      mergePluginConfig(
        {
          schedule: {
            frequency: { seconds: 30 },
            initialDelay: { seconds: 5 },
            timeout: { minutes: 1 },
          },
        },
        destination,
      );
      expect(destination.schedule).toEqual({
        frequency: { seconds: 30 },
        initialDelay: { seconds: 5 },
        timeout: { minutes: 1 },
      });
    });

    it("inserts the duration subtree when destination does not have it", () => {
      const destination: Record<string, unknown> = {
        schedule: { timeout: { minutes: 1 } },
      };
      mergePluginConfig(
        { schedule: { frequency: { seconds: 30 } } },
        destination,
      );
      expect(destination).toEqual({
        schedule: {
          timeout: { minutes: 1 },
          frequency: { seconds: 30 },
        },
      });
    });
  });
});
