import { APIRequestContext, APIResponse, request } from "@playwright/test";
import playwrightConfig from "../../../playwright.config";
import { Notifications } from "./notifications-api-structures";

export default class RhdhNotficationsApi {
  private readonly apiUrl = playwrightConfig.use.baseURL + "/api/";
  private readonly authHeader: {
    Accept: "application/json";
    Authorization: string;
  };
  private myContext: APIRequestContext;
  private constructor(private readonly token: string) {
    this.authHeader = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  public static async build(token: string): Promise<RhdhNotficationsApi> {
    const instance = new RhdhNotficationsApi(token);
    instance.myContext = await request.newContext({
      baseURL: instance.apiUrl,
      extraHTTPHeaders: instance.authHeader,
    });
    return instance;
  }

  // Create notifiation
  public async createNotification(
    notifications: Notifications,
  ): Promise<APIResponse> {
    return await this.myContext.post("notifications", { data: notifications });
  }

  // Mark all notifications as read
  public async markAllNotificationsAsRead(): Promise<APIResponse> {
    return await this.myContext.patch("notifications", {
      data: {
        ids: [],
        read: true,
      },
    });
  }
}
