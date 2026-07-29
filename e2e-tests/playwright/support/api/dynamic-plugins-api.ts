import type { APIRequestContext } from "@playwright/test";

import { parseLoadedPluginNames, parseScalprumPluginNames } from "../../utils/plugin-loader";
import { parseRefreshToken } from "./rhdh-auth-api-hack";

/**
 * The backend's own view of its dynamic plugins, for the cluster-free plugin
 * sanity check. Keeps the auth dance and the endpoint paths out of the spec.
 */
export class DynamicPluginsApi {
  private constructor(
    private readonly request: APIRequestContext,
    private readonly token: string,
  ) {}

  /** Authenticates as guest; loaded-plugins requires user credentials. */
  public static async build(request: APIRequestContext): Promise<DynamicPluginsApi> {
    const refresh = await request.get("/api/auth/guest/refresh", {
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });
    if (refresh.status() !== 200) {
      throw new Error(`guest auth refresh failed with status ${refresh.status()}`);
    }
    return new DynamicPluginsApi(request, parseRefreshToken(await refresh.json()));
  }

  /**
   * Package names the product's dynamic plugin loader actually loaded. The
   * endpoint filters out plugins that failed, so absence is the failure signal.
   */
  public async loadedPluginNames(): Promise<Set<string>> {
    const response = await this.request.get("/api/dynamic-plugins-info/loaded-plugins", {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (response.status() !== 200) {
      throw new Error(`loaded-plugins responded with status ${response.status()}`);
    }
    return parseLoadedPluginNames(await response.json());
  }

  /**
   * Frontend plugins the scalprum backend will serve to the browser. Worth
   * asserting separately: that router logs a warning and skips a plugin whose
   * dist-scalprum is unusable, while the plugin still shows up as "loaded".
   */
  public async scalprumPluginNames(): Promise<Set<string>> {
    const response = await this.request.get("/api/scalprum/plugins");
    if (response.status() !== 200) {
      throw new Error(`scalprum plugins responded with status ${response.status()}`);
    }
    return parseScalprumPluginNames(await response.json());
  }
}
