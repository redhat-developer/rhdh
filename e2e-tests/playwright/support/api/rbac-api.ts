import { APIRequestContext, APIResponse, request } from "@playwright/test";
import playwrightConfig from "../../../playwright.config";
import { Policy, Role } from "./rbac-api-structures";

export default class RhdhRbacApi {
  private readonly apiUrl = playwrightConfig.use.baseURL + "/api/permission/";
  private readonly authHeader: {
    Accept: "application/json";
    Authorization: string;
  };
  private myContext: APIRequestContext;
  private readonly roleRegex = /^[a-zA-Z]+\/[a-zA-Z]+$/;

  private constructor(private readonly token: string) {
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

  //Roles:

  public async getRoles(): Promise<APIResponse> {
    return await this.myContext.get("roles");
  }

  public async getRole(): Promise<APIResponse> {
    return await this.myContext.get("role");
  }
  public async updateRole(
    role: string /* shall be like: default/admin */,
    oldRole: Role,
    newRole: Role,
  ): Promise<APIResponse> {
    this.checkRoleFormat(role);
    return await this.myContext.put(`roles/role/${role}`, {
      data: { oldRole, newRole },
    });
  }
  public async createRoles(role: Role): Promise<APIResponse> {
    return await this.myContext.post("roles", { data: role });
  }

  public async deleteRole(role: string): Promise<APIResponse> {
    return await this.myContext.delete(`roles/role/${role}`);
  }

  //Policies:

  public async getPolicies(): Promise<APIResponse> {
    return await this.myContext.get("policies");
  }

  public async getPolicy(policy: string): Promise<APIResponse> {
    return await this.myContext.get(`policies/${policy}`);
  }

  public async createPolicies(policy: Policy[]): Promise<APIResponse> {
    return await this.myContext.post("policies", { data: policy });
  }

  public async updatePolicy(
    role: string /* shall be like: default/admin */,
    oldPolicy: Policy[],
    newPolicy: Policy[],
  ): Promise<APIResponse> {
    this.checkRoleFormat(role);
    return await this.myContext.put(`policies/role/${role}`, {
      data: { oldPolicy, newPolicy },
    });
  }
  public async deletePolicy(policy: string, policies: Policy[]) {
    this.checkRoleFormat(policy);
    return await this.myContext.delete(`policies/role/${policy}`, {
      data: policies,
    });
  }

  private checkRoleFormat(role: string) {
    if (!this.roleRegex.test(role))
      throw Error(
        "roles passed to the Rbac api must have format like: default/admin",
      );
  }
}
