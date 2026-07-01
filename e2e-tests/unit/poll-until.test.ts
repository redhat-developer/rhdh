import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  pollForValue,
  pollUntil,
  pollUntilStable,
  sleep,
  waitForNextTotpWindow,
} from "../playwright/utils/poll-until";

describe("sleep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves after the requested delay", async () => {
    const promise = sleep(250);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toBeUndefined();
  });
});

describe("pollUntil", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns immediately when the condition is true on the first call", async () => {
    let calls = 0;
    await pollUntil(() => {
      calls += 1;
      return Promise.resolve(true);
    });
    expect(calls).toBe(1);
  });

  it("polls until the condition becomes true", async () => {
    let calls = 0;
    const promise = pollUntil(
      () => {
        calls += 1;
        return Promise.resolve(calls >= 3);
      },
      { timeoutMs: 5000, intervalMs: 500 },
    );

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(calls).toBe(3);
  });

  it("throws the default timeout error", async () => {
    const promise = pollUntil(() => Promise.resolve(false), {
      timeoutMs: 1000,
      intervalMs: 500,
    });

    const rejection = expect(promise).rejects.toThrow(/Condition not met within 1000ms/u);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });

  it("throws a custom label on timeout", async () => {
    const promise = pollUntil(() => Promise.resolve(false), {
      timeoutMs: 1000,
      intervalMs: 500,
      label: "deployment not ready",
    });

    const rejection = expect(promise).rejects.toThrow(/deployment not ready/u);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });

  it("propagates errors from the condition", async () => {
    await expect(pollUntil(() => Promise.reject(new Error("condition failed")))).rejects.toThrow(
      /condition failed/u,
    );
  });
});

describe("pollUntilStable", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("requires consecutive true results", async () => {
    let calls = 0;
    const promise = pollUntilStable(
      () => {
        calls += 1;
        return Promise.resolve(true);
      },
      { timeoutMs: 5000, intervalMs: 500, stableChecks: 2 },
    );

    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(calls).toBe(2);
  });

  it("resets the consecutive counter when the condition becomes false", async () => {
    const results = [true, false, true, true];
    let index = 0;
    let calls = 0;
    const promise = pollUntilStable(
      () => {
        calls += 1;
        return Promise.resolve(results[index++]);
      },
      { timeoutMs: 5000, intervalMs: 500, stableChecks: 2 },
    );

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await promise;

    expect(calls).toBe(4);
  });

  it("times out when stability is never reached", async () => {
    const promise = pollUntilStable(() => Promise.resolve(true), {
      timeoutMs: 1000,
      intervalMs: 500,
      stableChecks: 5,
    });

    const rejection = expect(promise).rejects.toThrow(/Condition not met within 1000ms/u);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });
});

describe("pollForValue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the first non-null value", async () => {
    const responses: Array<string | null> = [null, "ready"];
    let calls = 0;
    const promise = pollForValue(
      () => {
        calls += 1;
        return Promise.resolve(responses[calls - 1] ?? null);
      },
      { timeoutMs: 5000, intervalMs: 500 },
    );

    await vi.advanceTimersByTimeAsync(500);
    const value = await promise;

    expect(value).toBe("ready");
    expect(calls).toBe(2);
  });

  it("keeps polling while the function returns null or undefined", async () => {
    const responses: Array<number | null | undefined> = [null, undefined, 42];
    let calls = 0;
    const promise = pollForValue(
      () => {
        calls += 1;
        return Promise.resolve(responses[calls - 1] ?? null);
      },
      { timeoutMs: 5000, intervalMs: 500 },
    );

    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    const value = await promise;

    expect(value).toBe(42);
    expect(calls).toBe(3);
  });

  it("throws a custom label on timeout", async () => {
    const promise = pollForValue(() => Promise.resolve(null), {
      timeoutMs: 1000,
      intervalMs: 500,
      label: "value never appeared",
    });

    const rejection = expect(promise).rejects.toThrow(/value never appeared/u);
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500);
    await rejection;
  });
});

describe("waitForNextTotpWindow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits only the buffer at the start of a TOTP window", async () => {
    vi.setSystemTime(0);

    const promise = waitForNextTotpWindow(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("waits until the next window plus buffer mid-window", async () => {
    vi.setSystemTime(15_000);

    const promise = waitForNextTotpWindow(1000);
    await vi.advanceTimersByTimeAsync(16_000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("uses a custom buffer", async () => {
    vi.setSystemTime(0);

    const promise = waitForNextTotpWindow(250);
    await vi.advanceTimersByTimeAsync(250);
    await expect(promise).resolves.toBeUndefined();
  });
});
