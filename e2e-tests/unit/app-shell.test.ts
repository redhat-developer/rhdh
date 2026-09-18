import type { Locator, Page } from "@playwright/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  failFastOnPageError,
  formatPageErrors,
  resetPageErrors,
  watchPageErrors,
} from "../playwright/support/auth/app-shell";

type FakePageHandle = {
  page: Page;
  emit: (event: string, payload?: unknown) => void;
};

function fakePage(overrides: Partial<{ closed: boolean; url: string }> = {}): FakePageHandle {
  const listeners = new Map<string, ((payload: unknown) => void)[]>();
  const fake = {
    on: (event: string, listener: (payload: unknown) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      return fake;
    },
    isClosed: () => overrides.closed ?? false,
    url: () => {
      if (overrides.closed === true) {
        throw new Error("Target page, context or browser has been closed");
      }
      return overrides.url ?? "https://rhdh.example.com/";
    },
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    page: fake as unknown as Page,
    emit: (event, payload) => {
      for (const listener of listeners.get(event) ?? []) {
        listener(payload);
      }
    },
  };
}

type FakeLocator = {
  waitFor: ReturnType<typeof vi.fn>;
  isVisible: ReturnType<typeof vi.fn>;
};

function asLocator(fake: FakeLocator): Locator {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return fake as unknown as Locator;
}

function stuckLocator(): FakeLocator {
  return {
    waitFor: vi.fn<() => Promise<void>>().mockRejectedValue(new Error("Timeout 10000ms exceeded")),
    isVisible: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
  };
}

describe("watchPageErrors", () => {
  it("accumulates uncaught page errors", () => {
    const { page, emit } = fakePage();
    const errors = watchPageErrors(page);
    emit("pageerror", new Error("boom"));
    emit("pageerror", new Error("boom 2"));
    expect(errors.map((error) => error.message)).toEqual(["boom", "boom 2"]);
  });

  it("is idempotent: a second call returns the same array without duplicating listeners", () => {
    const { page, emit } = fakePage();
    const first = watchPageErrors(page);
    const second = watchPageErrors(page);
    expect(second).toBe(first);
    emit("pageerror", new Error("once"));
    expect(first).toHaveLength(1);
  });

  it("keeps errors raised while the new document is still loading", () => {
    const { page, emit } = fakePage();
    const errors = resetPageErrors(page);
    emit("pageerror", new Error("crash before domcontentloaded"));
    emit("domcontentloaded");
    expect(errors.map((error) => error.message)).toEqual(["crash before domcontentloaded"]);
  });

  it("keeps errors across client-side navigations", () => {
    const { page, emit } = fakePage();
    const errors = watchPageErrors(page);
    emit("pageerror", new Error("bootstrap crash"));
    emit("framenavigated");
    expect(errors.map((error) => error.message)).toEqual(["bootstrap crash"]);
  });

  it("resetPageErrors clears previous errors and keeps watching", () => {
    const { page, emit } = fakePage();
    const errors = watchPageErrors(page);
    emit("pageerror", new Error("stale, from previous document"));
    const same = resetPageErrors(page);
    expect(same).toBe(errors);
    expect(errors).toHaveLength(0);
    emit("pageerror", new Error("fresh crash"));
    expect(errors.map((error) => error.message)).toEqual(["fresh crash"]);
  });
});

describe("formatPageErrors", () => {
  it("dedupes repeated messages and caps the list", () => {
    const repeated = Array.from({ length: 50 }, () => new Error("same TDZ error"));
    const distinct = Array.from({ length: 7 }, (_, i) => new Error(`error ${i}`));
    expect(formatPageErrors(repeated)).toBe("same TDZ error");
    expect(formatPageErrors([...repeated, ...distinct])).toContain("…and 3 more");
  });
});

describe("failFastOnPageError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects with the real JS error when the spinner stays visible after the grace period", async () => {
    const { page, emit } = fakePage({
      url: "https://rhdh.example.com/catalog",
    });
    const errors = watchPageErrors(page);
    const promise = failFastOnPageError(
      page,
      asLocator(stuckLocator()),
      errors,
      Date.now() + 120_000,
      () => false,
    );
    const outcome = promise.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    emit("pageerror", new Error("Cannot access 'y' before initialization"));
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(outcome).resolves.toContain("Cannot access 'y' before initialization");
    await expect(outcome).resolves.toContain("https://rhdh.example.com/catalog");
  });

  it("resolves silently when the app recovers within the grace period", async () => {
    const { page, emit } = fakePage();
    const errors = watchPageErrors(page);
    const recoveredLocator: FakeLocator = {
      waitFor: vi.fn<() => Promise<void>>().mockImplementation(async () => {}),
      isVisible: vi.fn<() => Promise<boolean>>().mockResolvedValue(false),
    };
    const promise = failFastOnPageError(
      page,
      asLocator(recoveredLocator),
      errors,
      Date.now() + 120_000,
      () => false,
    );
    emit("pageerror", new Error("non-fatal"));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBeUndefined();
  });

  it("still surfaces the collected error when the page died during the wait", async () => {
    const { page, emit } = fakePage({ closed: true });
    const errors = watchPageErrors(page);
    const closedLocator: FakeLocator = {
      waitFor: vi
        .fn<() => Promise<void>>()
        .mockRejectedValue(new Error("Target page has been closed")),
      isVisible: vi
        .fn<() => Promise<boolean>>()
        .mockRejectedValue(new Error("Target page has been closed")),
    };
    const promise = failFastOnPageError(
      page,
      asLocator(closedLocator),
      errors,
      Date.now() + 120_000,
      () => false,
    );
    const outcome = promise.then(
      () => "resolved",
      (error: Error) => error.message,
    );
    emit("pageerror", new Error("bootstrap crash"));
    await vi.advanceTimersByTimeAsync(11_000);
    await expect(outcome).resolves.toContain("bootstrap crash");
    await expect(outcome).resolves.toContain("<page closed>");
  });

  it("resolves quietly at the deadline when no page error ever occurs", async () => {
    const { page } = fakePage();
    const errors = watchPageErrors(page);
    const locator = stuckLocator();
    const promise = failFastOnPageError(
      page,
      asLocator(locator),
      errors,
      Date.now() + 2_000,
      () => false,
    );
    await vi.advanceTimersByTimeAsync(3_000);
    await expect(promise).resolves.toBeUndefined();
    expect(locator.waitFor).not.toHaveBeenCalled();
  });

  it("stops watching once the wait is settled", async () => {
    const { page, emit } = fakePage();
    const errors = watchPageErrors(page);
    let settled = false;
    const promise = failFastOnPageError(
      page,
      asLocator(stuckLocator()),
      errors,
      Date.now() + 120_000,
      () => settled,
    );
    settled = true;
    emit("pageerror", new Error("too late"));
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(promise).resolves.toBeUndefined();
  });
});
