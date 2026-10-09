import { type Page } from "@playwright/test";

import { KubeClient } from "../../utils/kube-client";
import { stopRuntimeApplication, resumeRuntimeApplication } from "../../utils/runtime-lifecycle";
import { waitForRhdhReady } from "../../utils/wait-for-rhdh-ready";
import { signInAsGuest } from "../auth/guest-auth";

export class RuntimeHarness {
  constructor(
    private readonly namespace: string,
    private readonly kubeClient: KubeClient = new KubeClient(),
  ) {}

  /** Restore the original configuration and restart even when the behavioral assertion fails. */
  async withAppTitle(title: string, verify: () => Promise<void>): Promise<void> {
    const name = await this.kubeClient.findAppConfigMap(this.namespace);
    const original = await this.kubeClient.getConfigMap(name, this.namespace);
    const errors: unknown[] = [];
    try {
      await stopRuntimeApplication(this.kubeClient, this.namespace);
      await this.kubeClient.updateConfigMapTitle(name, this.namespace, title);
      await resumeRuntimeApplication(this.kubeClient, this.namespace);
      await verify();
    } catch (error) {
      errors.push(error);
    }
    try {
      await stopRuntimeApplication(this.kubeClient, this.namespace);
      const current = await this.kubeClient.getConfigMap(name, this.namespace);
      current.body.data = original.body.data;
      await this.kubeClient.coreV1Api.replaceNamespacedConfigMap(
        name,
        this.namespace,
        current.body,
      );
      await resumeRuntimeApplication(this.kubeClient, this.namespace);
    } catch (error) {
      errors.push(error);
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "ConfigMap check and recovery failed");
  }

  /** Clear session state and sign in as guest after a deployment restart. */
  async verifyGuestSession(page: Page): Promise<void> {
    // Pod readiness can precede route propagation; never navigate to a cached router 503 page.
    await waitForRhdhReady(page.request, 180_000);
    await page.context().clearCookies();
    await page.context().clearPermissions();
    await page.reload({ waitUntil: "domcontentloaded" });
    await signInAsGuest(page);
  }
}
