import { ensurePlaywrightReady } from "./utils/instance-readiness";

export default async function globalSetup(): Promise<void> {
  await ensurePlaywrightReady();
}
