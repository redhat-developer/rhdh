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

const SPAWN_STDIO = ["ignore", "pipe", "pipe"] as const;

export class PortForwardSession {
  private child: ChildProcessByStdio<null, Readable, Readable> | null = null;
  private readonly output: string[] = [];
  private outputBuffer = "";

  constructor(
    private readonly command: PortForwardCommand,
    private readonly options: PortForwardOptions,
  ) {}

  async start(): Promise<ChildProcessByStdio<null, Readable, Readable>> {
    if (this.child !== null) {
      return this.child;
    }

    this.output.length = 0;
    this.outputBuffer = "";
    // detached: true makes the child a process-group leader so stop() can kill
    // kubectl (or other) grandchildren started via shellCommand.
    const spawnOpts = {
      stdio: SPAWN_STDIO,
      detached: true,
    } as const;
    const child =
      "shellCommand" in this.command
        ? spawn("/bin/sh", ["-c", this.command.shellCommand], spawnOpts)
        : spawn(this.command.command, this.command.args, spawnOpts);

    this.child = child;

    const readyTimeoutMs = this.options.readyTimeoutMs ?? 30_000;
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(
          new Error(`Timed out waiting for port-forward to be ready.\n${this.output.join("")}`),
        );
      }, readyTimeoutMs);

      const handleOutput = (chunk: Buffer | string) => {
        const text = chunk.toString();
        this.output.push(text);
        this.outputBuffer += text;
        if (this.options.readyPattern.test(this.outputBuffer)) {
          cleanup();
          resolve();
        }
      };

      const handleExit = (code: number | null, signal: NodeJS.Signals | null) => {
        cleanup();
        reject(
          new Error(
            `Port-forward exited before it became ready (code=${code}, signal=${signal}).\n${this.output.join("")}`,
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

    const pid = child.pid;
    if (pid === undefined || pid === 0) {
      return;
    }

    const stopTimeoutMs = this.options.stopTimeoutMs ?? 5_000;
    const killTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        PortForwardSession.killProcessGroup(pid, "SIGKILL");
      }
    }, stopTimeoutMs);

    PortForwardSession.killProcessGroup(pid, "SIGTERM");
    await once(child, "exit");
    clearTimeout(killTimeout);
  }

  private static killProcessGroup(pid: number, signal: NodeJS.Signals): void {
    try {
      // Negative PID kills the whole process group (shell + kubectl children).
      process.kill(-pid, signal);
    } catch {
      try {
        process.kill(pid, signal);
      } catch {
        // Already exited.
      }
    }
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
