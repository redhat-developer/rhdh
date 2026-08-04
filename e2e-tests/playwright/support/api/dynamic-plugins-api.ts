import type { APIRequestContext } from "@playwright/test";

import { isUnknownArray } from "../../utils/api-helper/guards";
import { parseRefreshToken } from "./rhdh-auth-api-hack";

async function getJson(
  request: APIRequestContext,
  path: string,
  headers?: Record<string, string>,
): Promise<unknown> {
  const response = await request.get(path, headers === undefined ? {} : { headers });
  if (response.status() !== 200) {
    throw new Error(`${path} responded with status ${response.status()}`);
  }
  return response.json();
}

/**
 * Parse the /api/dynamic-plugins-info/loaded-plugins response into the set of
 * loaded plugin package names. Throws when the payload is not the expected
 * array shape, so schema drift fails loudly instead of as a false mismatch.
 */
export function parseLoadedPluginNames(body: unknown): Set<string> {
  if (!isUnknownArray(body)) {
    throw new Error(`Expected loaded-plugins response to be an array, got: ${typeof body}`);
  }

  const names = new Set<string>();
  for (const item of body) {
    const name =
      typeof item === "object" && item !== null && "name" in item && typeof item.name === "string"
        ? item.name
        : undefined;
    if (name === undefined) {
      // Silently dropping a malformed entry would surface later as a
      // confusing "installed but not loaded" mismatch - fail at the cause.
      throw new Error(`loaded-plugins item without a string name: ${JSON.stringify(item)}`);
    }
    names.add(name);
  }
  return names;
}

/**
 * Parse the /api/scalprum/plugins response (a name -> descriptor map) into the
 * set of frontend plugins the backend will actually serve to the browser.
 */
export function parseScalprumPluginNames(body: unknown): Set<string> {
  if (typeof body !== "object" || body === null || isUnknownArray(body)) {
    throw new Error(`Expected scalprum plugins response to be an object, got: ${typeof body}`);
  }
  return new Set(Object.keys(body));
}

/**
 * Frontend plugins the scalprum backend will serve to the browser. Worth
 * asserting separately: that router logs a warning and skips a plugin whose
 * dist-scalprum is unusable, while the plugin still shows up as "loaded".
 *
 * A plain function rather than a method on the class below: the endpoint belongs
 * to a different backend plugin and needs no credentials.
 */
export async function fetchScalprumPluginNames(request: APIRequestContext): Promise<Set<string>> {
  return parseScalprumPluginNames(await getJson(request, "/api/scalprum/plugins"));
}

/**
 * The backend's own view of the dynamic plugins it loaded, for the cluster-free
 * plugin sanity check. Keeps the auth dance and the endpoint out of the spec.
 */
export class RhdhDynamicPluginsApi {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly authorization: Record<string, string>,
  ) {}

  /** Authenticates as guest; loaded-plugins requires user credentials. */
  public static async build(request: APIRequestContext): Promise<RhdhDynamicPluginsApi> {
    const session = await getJson(request, "/api/auth/guest/refresh", {
      "X-Requested-With": "XMLHttpRequest",
    });
    return new RhdhDynamicPluginsApi(request, {
      Authorization: `Bearer ${parseRefreshToken(session)}`,
    });
  }

  /**
   * Package names the product's dynamic plugin loader actually loaded. The
   * endpoint filters out plugins that failed, so absence is the failure signal.
   */
  public async loadedPluginNames(): Promise<Set<string>> {
    return parseLoadedPluginNames(
      await getJson(this.request, "/api/dynamic-plugins-info/loaded-plugins", this.authorization),
    );
  }
}
