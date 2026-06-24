const DEFAULT_POLL_INTERVAL_MS = 500;

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export type PollUntilOptions = {
  timeoutMs?: number;
  intervalMs?: number;
  label?: string;
};

/** Poll until `condition` returns true or timeout. */
export async function pollUntil(
  condition: () => Promise<boolean>,
  options: PollUntilOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 60_000;
  const intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await condition()) {
      return;
    }
    await sleep(intervalMs);
  }

  throw new Error(options.label ?? `Condition not met within ${timeoutMs}ms`);
}

/** Poll until `condition` is true for `stableChecks` consecutive evaluations. */
export async function pollUntilStable(
  condition: () => Promise<boolean>,
  options: PollUntilOptions & { stableChecks?: number } = {},
): Promise<void> {
  const stableChecks = options.stableChecks ?? 2;
  let consecutive = 0;

  await pollUntil(async () => {
    if (await condition()) {
      consecutive += 1;
      return consecutive >= stableChecks;
    }
    consecutive = 0;
    return false;
  }, options);
}

/** Poll until `fn` returns a non-null value. */
export async function pollForValue<T>(
  fn: () => Promise<T | null | undefined>,
  options: PollUntilOptions = {},
): Promise<T> {
  let result: T | null | undefined;

  await pollUntil(async () => {
    result = await fn();
    return result !== null && result !== undefined;
  }, options);

  if (result === null || result === undefined) {
    throw new Error(options.label ?? "pollForValue: no value returned");
  }
  return result;
}

/** Wait until the next UTC TOTP window (30s) plus a small buffer. */
export async function waitForNextTotpWindow(bufferMs = 1000): Promise<void> {
  const now = Date.now();
  const windowMs = 30_000;
  const msIntoWindow = now % windowMs;
  const waitMs = msIntoWindow === 0 ? bufferMs : windowMs - msIntoWindow + bufferMs;
  await sleep(waitMs);
}
