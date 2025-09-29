import KcAdminClient from "@keycloak/keycloak-admin-client";
import UserRepresentation from "@keycloak/keycloak-admin-client/lib/defs/userRepresentation";
import GroupRepresentation from "@keycloak/keycloak-admin-client/lib/defs/groupRepresentation";

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
        async () => {
          await this.kcAdminClient.auth({
            clientId: this.config.clientId,
            clientSecret: this.config.clientSecret,
            grantType: "client_credentials",
          });
        },
        58 * 60 * 1000,
      );

      console.log("Keycloak admin client initialized successfully");
    } catch (error) {
      console.error("Failed to initialize Keycloak admin client:", error);
      throw error;
    }
  }

  // User Management
  async createUser(user: UserRepresentation): Promise<string> {
    try {
      const { id } = await this.kcAdminClient.users.create(user);
      console.log(`User created successfully with ID: ${id}`);
      return id;
    } catch (error) {
      console.error("Failed to create user:", error);
      throw error;
    }
  }

  async updateUser(userId: string, user: UserRepresentation): Promise<void> {
    try {
      await this.kcAdminClient.users.update({ id: userId }, user);
      console.log(`User ${userId} updated successfully`);
    } catch (error) {
      console.error(`Failed to update user ${userId}:`, error);
      throw error;
    }
  }

  async deleteUser(userId: string): Promise<void> {
    try {
      await this.kcAdminClient.users.del({ id: userId });
      console.log(`User ${userId} deleted successfully`);
    } catch (error) {
      console.error(`Failed to delete user ${userId}:`, error);
      throw error;
    }
  }

  async findUserByUsername(
    username: string,
  ): Promise<UserRepresentation | undefined> {
    try {
      const users = await this.kcAdminClient.users.find({ username });
      console.log(users);
      return users[0];
    } catch (error) {
      console.error(`Failed to find user ${username}:`, error);
      throw error;
    }
  }

  // Group Management
  async createGroup(group: GroupRepresentation): Promise<string> {
    try {
      const { id } = await this.kcAdminClient.groups.create(group);
      console.log(`Group created successfully with ID: ${id}`);
      return id;
    } catch (error) {
      console.error("Failed to create group:", error);
      throw error;
    }
  }

  async updateGroup(
    groupId: string,
    group: GroupRepresentation,
  ): Promise<void> {
    try {
      await this.kcAdminClient.groups.update({ id: groupId }, group);
      console.log(`Group ${groupId} updated successfully`);
    } catch (error) {
      console.error(`Failed to update group ${groupId}:`, error);
      throw error;
    }
  }

  async deleteGroup(groupId: string): Promise<void> {
    try {
      await this.kcAdminClient.groups.del({ id: groupId });
      console.log(`Group ${groupId} deleted successfully`);
    } catch (error) {
      console.error(`Failed to delete group ${groupId}:`, error);
      throw error;
    }
  }

  // User-Group Management
  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    try {
      await this.kcAdminClient.users.addToGroup({ id: userId, groupId });
      console.log(`User ${userId} added to group ${groupId} successfully`);
    } catch (error) {
      console.error(`Failed to add user ${userId} to group ${groupId}:`, error);
      throw error;
    }
  }

  async removeUserFromGroup(userId: string, groupId: string): Promise<void> {
    try {
      await this.kcAdminClient.users.delFromGroup({ id: userId, groupId });
      console.log(`User ${userId} removed from group ${groupId} successfully`);
    } catch (error) {
      console.error(
        `Failed to remove user ${userId} from group ${groupId}:`,
        error,
      );
      throw error;
    }
  }

  // Session Management
  async clearUserSessions(username: string): Promise<void> {
    try {
      const user = await this.findUserByUsername(username);
      if (!user) {
        throw new Error(`User ${username} not found`);
      }

      const sessions = await this.kcAdminClient.users.listSessions({
        id: user.id,
      });
      console.log(`Clearing ${sessions.length} sessions for user ${username}`);

      for (const session of sessions) {
        await this.kcAdminClient.realms.removeSession({
          realm: this.config.realmName,
          sessionId: session.id,
        });
      }

      console.log(`All sessions cleared for user ${username}`);
    } catch (error) {
      console.error(`Failed to clear sessions for user ${username}:`, error);
      throw error;
    }
  }
}
