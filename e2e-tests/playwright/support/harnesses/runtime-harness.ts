import { type Page } from "@playwright/test";

import {
  configureCloudSqlProxyInstance,
  createCloudSqlServiceAccountSecret,
  injectCloudSqlSidecar,
} from "../../utils/cloudsql-config";
import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { pollUntil } from "../../utils/poll-until";
import {
  configurePostgresCertificate,
  configurePostgresCredentials,
  prepareForExternalDatabase,
} from "../../utils/postgres-config";
import { signInAsGuest } from "../auth/guest-auth";

type ExternalPostgresOptions = {
  certificateContent?: string | null;
  credentials: {
    host: string;
    port?: string;
    user: string;
    password: string;
    database?: string;
    sslMode?: string;
  };
};

export class RuntimeHarness {
  constructor(
    private readonly namespace: string,
    private readonly deploymentName: string = getRhdhDeploymentName(),
    private readonly kubeClient: KubeClient = new KubeClient(),
    private readonly releaseName: string = process.env.RELEASE_NAME ?? "rhdh",
  ) {}

  async updateConfigMapTitle(configMapName: string, title: string): Promise<void> {
    await this.kubeClient.updateConfigMapTitle(configMapName, this.namespace, title);
  }

  async configurePostgresCertificate(certificateContent: string): Promise<void> {
    await configurePostgresCertificate(this.kubeClient, this.namespace, certificateContent);
  }

  async configurePostgresCredentials(
    credentials: ExternalPostgresOptions["credentials"],
  ): Promise<void> {
    await configurePostgresCredentials(this.kubeClient, this.namespace, credentials);
  }

  async restartDeployment(): Promise<void> {
    await this.kubeClient.restartDeployment(this.deploymentName, this.namespace);
  }

  async restartDeploymentWithRetry(timeoutMs = 90_000, intervalMs = 15_000): Promise<void> {
    let lastError: unknown;
    try {
      await pollUntil(
        async () => {
          try {
            await this.restartDeployment();
            return true;
          } catch (error) {
            lastError = error;
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`Deployment restart failed, retrying: ${message}`);
            return false;
          }
        },
        {
          timeoutMs,
          intervalMs,
          label: "Failed to restart deployment",
        },
      );
    } catch {
      const message = lastError instanceof Error ? lastError.message : "unknown error";
      throw new Error(`Failed to restart deployment: ${message}`);
    }
  }

  async configureExternalPostgres(options: ExternalPostgresOptions): Promise<void> {
    if (options.certificateContent !== undefined && options.certificateContent !== null) {
      await this.configurePostgresCertificate(options.certificateContent);
    }
    await this.configurePostgresCredentials(options.credentials);
    await this.restartDeploymentWithRetry();
  }

  /** Patch app-config and deployment env for external PostgreSQL tests. */
  async prepareForExternalDatabase(): Promise<void> {
    await prepareForExternalDatabase(this.kubeClient, this.namespace, this.deploymentName);
  }

  /**
   * Prepare runtime for Google Cloud SQL via Auth Proxy sidecar.
   * Creates the SA secret, patches app-config, sets localhost credentials, and
   * injects the proxy for the first instance connection name.
   */
  async prepareForCloudSql(options: {
    serviceAccountJsonPath: string;
    initialInstanceConnectionName: string;
    user: string;
    password: string;
  }): Promise<void> {
    await createCloudSqlServiceAccountSecret(
      this.kubeClient,
      this.namespace,
      options.serviceAccountJsonPath,
    );
    await this.prepareForExternalDatabase();
    // Credentials must be valid before sidecar inject waits on Deployment ready.
    await this.configurePostgresCredentials({
      host: "127.0.0.1",
      user: options.user,
      password: options.password,
      sslMode: "disable",
    });
    await injectCloudSqlSidecar(
      this.kubeClient,
      this.namespace,
      this.releaseName,
      options.initialInstanceConnectionName,
    );
  }

  /**
   * Point the Auth Proxy at a Cloud SQL instance and set app credentials for
   * localhost (proxy) with SSL disabled. One restart waits for the proxy
   * startupProbe before RHDH becomes Ready.
   */
  async configureCloudSqlInstance(options: {
    instanceConnectionName: string;
    user: string;
    password: string;
  }): Promise<void> {
    await this.configurePostgresCredentials({
      host: "127.0.0.1",
      user: options.user,
      password: options.password,
      sslMode: "disable",
    });
    await configureCloudSqlProxyInstance(
      this.kubeClient,
      this.namespace,
      this.releaseName,
      options.instanceConnectionName,
    );
  }

  /** Clear session state and sign in as guest after a deployment restart. */
  async verifyGuestSession(page: Page): Promise<void> {
    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.reload({ waitUntil: "domcontentloaded" });
    await signInAsGuest(page);
  }
}
