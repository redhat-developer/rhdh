import type { APIRequestContext } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import {
  fetchScalprumPluginNames,
  RhdhDynamicPluginsApi,
} from "../playwright/support/api/dynamic-plugins-api";

type Route = { status?: number; body?: unknown };
type FakeResponse = { status: () => number; json: () => Promise<unknown> };
type FakeGet = (
  path: string,
  options?: { headers?: Record<string, string> },
) => Promise<FakeResponse>;

/**
 * A stand-in for APIRequestContext covering the three members this module uses.
 * Lets the auth headers and call count be asserted without booting a backend.
 */
function fakeRequest(routes: Record<string, Route>) {
  const get = vi.fn<FakeGet>((path) => {
    const route = routes[path];
    if (route === undefined) throw new Error(`unexpected GET ${path}`);
    return Promise.resolve({
      status: () => route.status ?? 200,
      json: () => Promise.resolve(route.body),
    });
  });
  // Faking the whole APIRequestContext surface is not worth it; only .get() is
  // reached, so narrow deliberately.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const request = { get } as unknown as APIRequestContext;
  return { request, get };
}

const GUEST_REFRESH = "/api/auth/guest/refresh";
const LOADED_PLUGINS = "/api/dynamic-plugins-info/loaded-plugins";
const SCALPRUM_PLUGINS = "/api/scalprum/plugins";

const session = { backstageIdentity: { token: "tok-123" } };

describe("RhdhDynamicPluginsApi", () => {
  it("sends the XMLHttpRequest header the guest refresh requires", async () => {
    const { request, get } = fakeRequest({ [GUEST_REFRESH]: { body: session } });

    await RhdhDynamicPluginsApi.build(request);

    expect(get).toHaveBeenCalledWith(GUEST_REFRESH, {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
  });

  it("authorises loaded-plugins with the token from the guest session", async () => {
    const { request, get } = fakeRequest({
      [GUEST_REFRESH]: { body: session },
      [LOADED_PLUGINS]: { body: [{ name: "plugin-a" }, { name: "plugin-b" }] },
    });

    const api = await RhdhDynamicPluginsApi.build(request);

    expect(await api.loadedPluginNames()).toEqual(new Set(["plugin-a", "plugin-b"]));
    expect(get).toHaveBeenCalledWith(LOADED_PLUGINS, {
      headers: { Authorization: "Bearer tok-123" },
    });
  });

  it("names the endpoint when it responds with a non-200", async () => {
    const { request } = fakeRequest({ [GUEST_REFRESH]: { status: 503, body: {} } });

    await expect(RhdhDynamicPluginsApi.build(request)).rejects.toThrow(
      /\/api\/auth\/guest\/refresh responded with status 503/u,
    );
  });
});

describe("fetchScalprumPluginNames", () => {
  it("collects the served plugin names", async () => {
    const { request } = fakeRequest({
      [SCALPRUM_PLUGINS]: {
        body: {
          "backstage-community.plugin-tekton": { name: "backstage-community.plugin-tekton" },
          "red-hat-developer-hub.plugin-orchestrator": {},
        },
      },
    });

    expect(await fetchScalprumPluginNames(request)).toEqual(
      new Set(["backstage-community.plugin-tekton", "red-hat-developer-hub.plugin-orchestrator"]),
    );
  });

  it("does not authenticate, since the endpoint is unauthenticated", async () => {
    const { request, get } = fakeRequest({ [SCALPRUM_PLUGINS]: { body: {} } });

    await fetchScalprumPluginNames(request);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith(SCALPRUM_PLUGINS, {});
  });
});
