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

function killProcessTree(
  child: ChildProcessByStdio<null, Readable, Readable>,
  signal: NodeJS.Signals,
): void {
  const pid = child.pid;
  if (pid === undefined) {
    return;
  }

  // Prefer process-group kill so shell-spawned kubectl/oc children die with the shell.
  // Detached sessions on POSIX put the child in its own group (negative PID).
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);
      return;
    } catch {
      // Fall through — group may not exist if spawn was not detached.
    }
  }

  child.kill(signal);
}

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

    // Detach on POSIX so stop() can signal the whole process group (shell + kubectl).
    const useProcessGroup = process.platform !== "win32";
    const child =
      "shellCommand" in this.command
        ? spawn("/bin/sh", ["-c", this.command.shellCommand], {
            stdio: ["ignore", "pipe", "pipe"],
            detached: useProcessGroup,
          })
        : spawn(this.command.command, this.command.args, {
            stdio: ["ignore", "pipe", "pipe"],
            detached: useProcessGroup,
          });

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

    const stopTimeoutMs = this.options.stopTimeoutMs ?? 5_000;
    const killTimeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        killProcessTree(child, "SIGKILL");
      }
    }, stopTimeoutMs);

    killProcessTree(child, "SIGTERM");
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
