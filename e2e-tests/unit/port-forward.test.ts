import { describe, expect, it } from "vitest";

import { PortForwardSession } from "../playwright/utils/port-forward";

describe("port-forward lifecycle", () => {
  it("discovers readiness, retains output and stops its direct child", async () => {
    const session = new PortForwardSession(
      {
        command: process.execPath,
        args: [
          "-e",
          'console.log("Forwarding from 127.0.0.1:12345 -> 5432"); setInterval(() => {}, 1000)',
        ],
      },
      { readyPattern: /Forwarding from/u },
    );
    const child = await session.start();
    try {
      session.assertRunning();
      expect(session.getOutput()).toContain("127.0.0.1:12345");
    } finally {
      await session.stop();
    }
    expect(child.signalCode).toBe("SIGTERM");
    expect(() => {
      session.assertRunning();
    }).toThrow("not running");
    await session.stop();
  });
  it("kills a child on startup timeout", async () => {
    const session = new PortForwardSession(
      {
        command: process.execPath,
        args: ["-e", "console.log(`pid:${process.pid}`); setInterval(() => {}, 1000)"],
      },
      { readyPattern: /never-ready/u, readyTimeoutMs: 500 },
    );
    await expect(session.start()).rejects.toThrow("Timed out");
    const pid = Number(/pid:(\d+)/u.exec(session.getOutput())?.[1]);
    expect(pid).toBeGreaterThan(0);
    expect(() => process.kill(pid, 0)).toThrow("ESRCH");
  });
  it("reports missing executable without hanging teardown", async () => {
    const session = new PortForwardSession(
      { command: "/nonexistent-cloudsql-port-forward", args: [] },
      { readyPattern: /ready/u },
    );
    await expect(session.start()).rejects.toThrow("spawn failed");
    await session.stop();
  });
});
