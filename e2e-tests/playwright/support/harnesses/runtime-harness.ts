import { type Page } from "@playwright/test";

import { KubeClient, getRhdhDeploymentName } from "../../utils/kube-client";
import { stopRuntimeApplication, resumeRuntimeApplication } from "../../utils/runtime-lifecycle";
import { signInAsGuest } from "../auth/guest-auth";

export class RuntimeHarness {
  constructor(
    private readonly namespace: string,
    private readonly deploymentName: string = getRhdhDeploymentName(),
    private readonly kubeClient: KubeClient = new KubeClient(),
  ) {}

  async updateConfigMapTitle(configMapName: string, title: string): Promise<void> {
    await this.stopDeployment();
    await this.kubeClient.updateConfigMapTitle(configMapName, this.namespace, title);
  }

  async restartDeployment(): Promise<void> {
    await this.stopDeployment();
    await resumeRuntimeApplication(this.kubeClient, this.namespace);
  }

  async stopDeployment(): Promise<void> {
    await stopRuntimeApplication(this.kubeClient, this.namespace);
  }

  async restartDeploymentWithRetry(): Promise<void> {
    // Readiness has one bounded deadline; never retry a partially completed mutation.
    await this.restartDeployment();
  }

  /** Clear session state and sign in as guest after a deployment restart. */
  async verifyGuestSession(page: Page): Promise<void> {
    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.reload({ waitUntil: "domcontentloaded" });
    await signInAsGuest(page);
  }
}
