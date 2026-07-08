import KcAdminClient from "@keycloak/keycloak-admin-client";

type UserRepresentation = NonNullable<Parameters<KcAdminClient["users"]["create"]>[0]>;

interface KeycloakConfig {
  baseUrl: string;
  realmName: string;
  clientId: string;
  clientSecret: string;
}

export class KeycloakHelper {
  private kcAdminClient: KcAdminClient;
  private config: KeycloakConfig;

  constructor(config: KeycloakConfig) {
    this.config = config;
    this.kcAdminClient = new KcAdminClient({
      baseUrl: config.baseUrl,
      realmName: config.realmName,
    });
  }

  async initialize(): Promise<void> {
    try {
      await this.kcAdminClient.auth({
        clientId: this.config.clientId,
        clientSecret: this.config.clientSecret,
        grantType: "client_credentials",
      });

      // Refresh token every 58 minutes
      setInterval(
        () => {
          void this.kcAdminClient.auth({
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            grantType: "client_credentials",
          });
        },
        58 * 60 * 1000,
      );

      console.log("[KEYCLOAK] Admin client initialized successfully");
    } catch (error) {
      console.error("[KEYCLOAK] Failed to initialize admin client:", error);
      throw error;
    }
  }

  async findUserByUsername(username: string): Promise<UserRepresentation | undefined> {
    try {
      console.log(`[KEYCLOAK] Finding user by username: ${username}`);
      const users = await this.kcAdminClient.users.find({ username });
      console.log(`[KEYCLOAK] Found ${users.length} users with username: ${username}`);
      return users[0];
    } catch (error) {
      console.error(`[KEYCLOAK] Failed to find user ${username}:`, error);
      throw error;
    }
  }

  // Session Management
  async clearUserSessions(username: string): Promise<void> {
    try {
      console.log(`[KEYCLOAK] Clearing sessions for user: ${username}`);
      const user = await this.findUserByUsername(username);
      if (!user) {
        throw new Error(`User ${username} not found`);
      }

      const sessions = await this.kcAdminClient.users.listSessions({
        id: user.id!,
      });
      console.log(`[KEYCLOAK] Found ${sessions.length} sessions for user ${username}`);

      for (const session of sessions) {
        await this.kcAdminClient.realms.removeSession({
          realm: this.config.realmName,
          sessionId: session.id!,
        });
      }

      console.log(`[KEYCLOAK] All sessions cleared for user ${username}`);
    } catch (error) {
      console.error(`[KEYCLOAK] Failed to clear sessions for user ${username}:`, error);
      throw error;
    }
  }
}
