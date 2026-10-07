import type { ChildProcessByStdio } from "node:child_process";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { Readable } from "node:stream";

export type PortForwardCommand =
  | {
      command: string;
      args: string[];
    }
  | {
      shellCommand: string;
    };

export type PortForwardOptions = {
  readyPattern: RegExp;
  readyTimeoutMs?: number;
  stopTimeoutMs?: number;
};

export class PortForwardSession {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private outputBuffer = "";

  constructor(
    private readonly command: PortForwardCommand,
    private readonly options: PortForwardOptions,
  ) {}

  getOutput(): string {
    return this.outputBuffer;
  }

  assertRunning(): void {
    if (!this.child || this.child.exitCode !== null || this.child.signalCode !== null) {
      throw new Error(`Port-forward is not running.\n${this.getOutput()}`);
    }
  }

  async start(): Promise<ChildProcessByStdio<null, Readable, Readable>> {
    if (this.child !== null) {
      return this.child;
    }

    this.outputBuffer = "";
    const child =
      "shellCommand" in this.command
        ? spawn("/bin/sh", ["-c", this.command.shellCommand], {
            stdio: ["ignore", "pipe", "pipe"],
          })
        : spawn(this.command.command, this.command.args, {
            stdio: ["ignore", "pipe", "pipe"],
          });

    this.child = child;
    const captureOutput = (chunk: Buffer | string) => {
      this.outputBuffer = (this.outputBuffer + chunk.toString()).slice(-64_000);
    };
    child.stdout.on("data", captureOutput);
    child.stderr.on("data", captureOutput);

    const readyTimeoutMs = this.options.readyTimeoutMs ?? 30_000;
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Timed out waiting for port-forward to be ready.\n${this.getOutput()}`));
        }, readyTimeoutMs);

        const handleOutput = () => {
          if (this.options.readyPattern.test(this.outputBuffer)) {
            cleanup();
            resolve();
          }
        };

        const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
          cleanup();
          reject(
            new Error(
              `Port-forward exited before it became ready (code=${code}, signal=${signal}).\n${this.getOutput()}`,
            ),
          );
        };

        const handleError = (error: Error) => {
          cleanup();
          reject(new Error(`Port-forward spawn failed: ${error.message}`));
        };

        const cleanup = () => {
          clearTimeout(timeout);
          child.stdout.off("data", handleOutput);
          child.stderr.off("data", handleOutput);
          child.off("exit", handleExit);
          child.off("error", handleError);
        };

        child.stdout.on("data", handleOutput);
        child.stderr.on("data", handleOutput);
        child.on("exit", handleExit);
        child.on("error", handleError);
      });
    } catch (error) {
      if (child.pid === undefined) this.child = null;
      else await this.stop();
      throw error;
    }

    return child;
  }

  async restart(): Promise<ChildProcessByStdio<null, Readable, Readable>> {
    await this.stop();
    return this.start();
  }

  async stop(): Promise<void> {
    const child = this.child;
    if (child === null) {
      return;
    }

    this.child = null;

    if (child.exitCode !== null || child.signalCode !== null) {
      return;
    }

    const stopTimeoutMs = this.options.stopTimeoutMs ?? 5_000;
    const killTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, stopTimeoutMs);

    child.kill("SIGTERM");
    await once(child, "exit");
    clearTimeout(killTimeout);
  }
}

let portForwardRestarter: (() => Promise<void>) | null = null;

/** @internal Bound by PortForwardHarness for schema-mode DB reconnect retries. */
export function bindPortForwardRestarter(fn: (() => Promise<void>) | null): void {
  portForwardRestarter = fn;
}

export function getPortForwardRestarter(): (() => Promise<void>) | null {
  return portForwardRestarter;
}
