import { type Page } from "@playwright/test";

import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { pollUntil } from "../../utils/poll-until";
import {
  configurePostgresCertificate,
  configurePostgresCredentials,
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

  /** Clear session state and sign in as guest after a deployment restart. */
  async verifyGuestSession(page: Page): Promise<void> {
    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.reload({ waitUntil: "domcontentloaded" });
    await signInAsGuest(page);
  }

  /** Restart the deployment and re-establish a guest session on the given page. */
  async restartAndVerifyGuestSession(page: Page): Promise<void> {
    await this.restartDeploymentWithRetry();
    await this.verifyGuestSession(page);
  }
}
