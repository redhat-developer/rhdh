import { describe, expect, it } from "vitest";

import {
  deploymentName,
  isPredictedRuntimeUrl,
  predictedUrl,
  routeObjectName,
  runtimeInstanceRouteIdentity,
} from "../playwright/utils/instance-route-identity";

describe("instance-route-identity", () => {
  it("names helm routes and deployments with the developer-hub suffix", () => {
    expect(routeObjectName("helm", "rhdh")).toBe("rhdh-developer-hub");
    expect(deploymentName("helm", "rhdh")).toBe("rhdh-developer-hub");
    expect(
      predictedUrl({
        installMethod: "helm",
        releaseName: "rhdh",
        namespace: "showcase-runtime",
        routerBase: "apps.cluster.example.com",
      }),
    ).toBe("https://rhdh-developer-hub-showcase-runtime.apps.cluster.example.com");
  });

  it("names operator routes and deployments with the backstage- prefix", () => {
    expect(routeObjectName("operator", "rhdh")).toBe("backstage-rhdh");
    expect(deploymentName("operator", "rhdh")).toBe("backstage-rhdh");
    expect(
      predictedUrl({
        installMethod: "operator",
        releaseName: "rhdh",
        namespace: "showcase-runtime",
        routerBase: "apps.cluster.example.com",
      }),
    ).toBe("https://backstage-rhdh-showcase-runtime.apps.cluster.example.com");
  });

  it("keeps an already-suffixed helm release name", () => {
    expect(routeObjectName("helm", "my-developer-hub")).toBe("my-developer-hub");
  });

  it("builds runtime identity from env defaults", () => {
    expect(
      runtimeInstanceRouteIdentity("helm", "apps.example.com", {
        RELEASE_NAME: "showcase",
        NAME_SPACE_RUNTIME: "showcase-runtime",
      }),
    ).toEqual({
      installMethod: "helm",
      releaseName: "showcase",
      namespace: "showcase-runtime",
      routerBase: "apps.example.com",
    });
  });

  it("matches only the predicted runtime URL for auto-deploy gating", () => {
    const env = {
      RELEASE_NAME: "rhdh",
      NAME_SPACE_RUNTIME: "showcase-runtime",
    };
    expect(
      isPredictedRuntimeUrl(
        "https://rhdh-developer-hub-showcase-runtime.apps.cluster.example.com",
        "helm",
        "apps.cluster.example.com",
        env,
      ),
    ).toBe(true);
    expect(
      isPredictedRuntimeUrl(
        "https://rhdh-developer-hub-showcase-sanity.apps.cluster.example.com",
        "helm",
        "apps.cluster.example.com",
        env,
      ),
    ).toBe(false);
    expect(
      isPredictedRuntimeUrl(
        "https://backstage-rhdh-showcase-runtime.apps.cluster.example.com",
        "helm",
        "apps.cluster.example.com",
        env,
      ),
    ).toBe(false);
  });
});
