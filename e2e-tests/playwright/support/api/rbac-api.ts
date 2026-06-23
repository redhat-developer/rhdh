import {
  APIRequestContext,
  APIResponse,
  Page,
  request,
} from "@playwright/test";
import playwrightConfig from "../../../playwright.config";
import { Policy, Role } from "./rbac-api-structures";
import { RhdhAuthApiHack } from "./rhdh-auth-api-hack";

export default class RhdhRbacApi {
  private readonly apiUrl: string;
  private readonly authHeader: {
    Accept: "application/json";
    Authorization: string;
  };
  private myContext!: APIRequestContext;
  private readonly roleRegex = /^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/u;

  private constructor(private readonly token: string) {
    const baseURL = playwrightConfig.use?.baseURL;
    if (baseURL === undefined || baseURL === "") {
      throw new Error("playwright.config use.baseURL is not defined");
    }
    this.apiUrl = baseURL + "/api/permission/";
    this.authHeader = {
      Accept: "application/json",
      Authorization: `Bearer ${this.token}`,
    };
  }

  public static async build(token: string): Promise<RhdhRbacApi> {
    const instance = new RhdhRbacApi(token);
    instance.myContext = await request.newContext({
      baseURL: instance.apiUrl,
      extraHTTPHeaders: instance.authHeader,
    });
    return instance;
  }

  public getRoles(): Promise<APIResponse> {
    return this.myContext.get("roles");
  }

  public getRole(role: string): Promise<APIResponse> {
    return this.myContext.get(`roles/role/${role}`);
  }

  public updateRole(
    role: string,
    oldRole: Role,
    newRole: Role,
  ): Promise<APIResponse> {
    this.checkRoleFormat(role);
    return this.myContext.put(`roles/role/${role}`, {
      data: { oldRole, newRole },
    });
  }

  public createRoles(role: Role): Promise<APIResponse> {
    return this.myContext.post("roles", { data: role });
  }

  public deleteRole(role: string): Promise<APIResponse> {
    return this.myContext.delete(`roles/role/${role}`);
  }

  public getPolicies(): Promise<APIResponse> {
    return this.myContext.get("policies");
  }

  public getPoliciesByRole(policy: string): Promise<APIResponse> {
    return this.myContext.get(`policies/role/${policy}`);
  }

  public getPoliciesByQuery(
    params: string | { [key: string]: string | number | boolean },
  ): Promise<APIResponse> {
    return this.myContext.get("policies", { params });
  }

  public createPolicies(policy: Policy[]): Promise<APIResponse> {
    return this.myContext.post("policies", { data: policy });
  }

  public updatePolicy(
    role: string,
    oldPolicy: Policy[],
    newPolicy: Policy[],
  ): Promise<APIResponse> {
    this.checkRoleFormat(role);
    return this.myContext.put(`policies/role/${role}`, {
      data: { oldPolicy, newPolicy },
    });
  }

  public deletePolicy(policy: string, policies: Policy[]) {
    this.checkRoleFormat(policy);
    return this.myContext.delete(`policies/role/${policy}`, {
      data: policies,
    });
  }

  public getConditions(): Promise<APIResponse> {
    return this.myContext.get("roles/conditions");
  }

  public getConditionByQuery(
    params: string | { [key: string]: string | number | boolean },
  ): Promise<APIResponse> {
    return this.myContext.get("roles/conditions", { params });
  }

  public getConditionById(id: number): Promise<APIResponse> {
    return this.myContext.get(`roles/conditions/${id}`);
  }

  public deleteConditionById(id: number): Promise<APIResponse> {
    return this.myContext.delete(`roles/conditions/${id}`);
  }

  public async dispose(): Promise<void> {
    await this.myContext.dispose();
  }

  private checkRoleFormat(role: string) {
    if (!this.roleRegex.test(role)) {
      throw new Error(
        "roles passed to the Rbac api must have format like: default/admin",
      );
    }
  }

  public static async buildRbacApi(page: Page): Promise<RhdhRbacApi> {
    const token = await RhdhAuthApiHack.getToken(page);
    return RhdhRbacApi.build(token);
  }
}
