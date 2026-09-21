import { renderWithEffects } from "@backstage/test-utils";
import {
  BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL,
  type RuntimeSharedDependenciesGlobal,
} from "@backstage/module-federation-common";

jest.setTimeout(30_000);

describe("App", () => {
  it("should render", async () => {
    process.env = {
      NODE_ENV: "test",
      APP_CONFIG: [
        {
          data: {
            app: {
              title: "Test",
              support: { url: "http://localhost:7007/support" },
            },
            backend: { baseUrl: "http://localhost:7007" },
            lighthouse: {
              baseUrl: "http://localhost:3003",
            },
            techdocs: {
              storageUrl: "http://localhost:7007/api/techdocs/static/docs",
            },
          },
          context: "test",
        },
      ] as any,
    };

    // Jest has no CLI-seeded MF shared-deps global; seed the v1 shape the app expects.
    (window as unknown as Record<string, RuntimeSharedDependenciesGlobal>)[
      BACKSTAGE_RUNTIME_SHARED_DEPENDENCIES_GLOBAL
    ] = { version: "v1", items: [] };

    const { default: app } = await import("./App");
    const rendered = await renderWithEffects(app);
    expect(rendered.baseElement).toBeInTheDocument();
  });
});
