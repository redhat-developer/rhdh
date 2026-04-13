/**
 * Start oc port-forward for schema-mode E2E when CI exports forward metadata.
 * Mirrors verify-redis-cache.spec.ts (spawn + wait for tunnel).
 * If SCHEMA_MODE_DB_HOST is set and forward metadata is absent, no process is spawned.
 */

import { spawn, ChildProcessWithoutNullStreams } from "child_process";
import * as net from "net";

export interface SchemaModePortForwardHandle {
  stop: () => void;
  isHealthy: () => boolean;
}

let portForwardProcess: ChildProcessWithoutNullStreams | undefined;
let portForwardHealthy = false;

function waitForLocalPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let attemptCount = 0;
    const tryConnect = () => {
      attemptCount++;
      if (Date.now() > deadline) {
        reject(
          new Error(
            `Timeout waiting for localhost:${port} after ${attemptCount} attempts`,
          ),
        );
        return;
      }
      const socket = net.createConnection({ port, host: "127.0.0.1" }, () => {
        socket.end();
        if (process.env.DEBUG_SCHEMA_MODE_PF) {
          console.log(
            `[schema-mode pf] Port ${port} ready after ${attemptCount} attempts`,
          );
        }
        resolve();
      });
      socket.on("error", (err) => {
        socket.destroy();
        if (process.env.DEBUG_SCHEMA_MODE_PF && attemptCount % 10 === 0) {
          console.log(
            `[schema-mode pf] Waiting for port ${port}, attempt ${attemptCount}: ${err.message}`,
          );
        }
        setTimeout(tryConnect, 300);
      });
    };
    tryConnect();
  });
}

/**
 * If SCHEMA_MODE_PORT_FORWARD_NAMESPACE and SCHEMA_MODE_PORT_FORWARD_RESOURCE are set,
 * spawns oc port-forward and sets SCHEMA_MODE_DB_HOST=localhost.
 * If only SCHEMA_MODE_DB_HOST is set (no forward metadata), returns a no-op stop.
 */
export async function ensureSchemaModePortForward(): Promise<SchemaModePortForwardHandle> {
  const ns = process.env.SCHEMA_MODE_PORT_FORWARD_NAMESPACE;
  const resource = process.env.SCHEMA_MODE_PORT_FORWARD_RESOURCE;
  const localPort = 5432;

  const hasMeta = Boolean(ns && resource);
  const hasHostOnly = Boolean(process.env.SCHEMA_MODE_DB_HOST) && !hasMeta;

  if (!hasMeta) {
    if (hasHostOnly) {
      return {
        stop: () => {},
        isHealthy: () => true,
      };
    }
    throw new Error(
      "Set SCHEMA_MODE_PORT_FORWARD_NAMESPACE + SCHEMA_MODE_PORT_FORWARD_RESOURCE (CI), or SCHEMA_MODE_DB_HOST for a direct connection",
    );
  }

  // Clean up any existing port-forward process
  if (portForwardProcess) {
    console.log("[schema-mode pf] Cleaning up existing port-forward process");
    try {
      portForwardProcess.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    portForwardProcess = undefined;
    portForwardHealthy = false;
  }

  console.log(
    `[schema-mode pf] Starting port-forward: ${resource} in ${ns} -> localhost:${localPort}`,
  );

  const child = spawn(
    "oc",
    ["port-forward", "-n", ns!, resource!, `${localPort}:5432`],
    {
      stdio: ["ignore", "pipe", "pipe"],
      detached: false,
    },
  ) as ChildProcessWithoutNullStreams;

  portForwardProcess = child;
  portForwardHealthy = false;

  const outputLines: string[] = [];
  const onOutput = (buf: Buffer) => {
    const line = buf.toString().trimEnd();
    outputLines.push(line);
    // Keep only last 50 lines
    if (outputLines.length > 50) {
      outputLines.shift();
    }

    if (line.includes("Forwarding from")) {
      portForwardHealthy = true;
      if (process.env.DEBUG_SCHEMA_MODE_PF) {
        console.log(`[schema-mode pf] ${line}`);
      }
    } else if (line.includes("error") || line.includes("Error")) {
      console.error(`[schema-mode pf] Error: ${line}`);
      portForwardHealthy = false;
    } else if (process.env.DEBUG_SCHEMA_MODE_PF) {
      console.log(`[schema-mode pf] ${line}`);
    }
  };
  child.stdout.on("data", onOutput);
  child.stderr.on("data", onOutput);

  child.on("error", (err) => {
    console.error("[schema-mode pf] Process error:", err);
    portForwardHealthy = false;
  });

  child.on("exit", (code, signal) => {
    portForwardHealthy = false;
    if (code !== null && code !== 0) {
      console.error(
        `[schema-mode pf] Process exited with code ${code}, signal ${signal}`,
      );
      if (outputLines.length > 0) {
        console.error(
          `[schema-mode pf] Last output:\n${outputLines.join("\n")}`,
        );
      }
    } else if (process.env.DEBUG_SCHEMA_MODE_PF) {
      console.log(
        `[schema-mode pf] Process exited normally (code ${code}, signal ${signal})`,
      );
    }
  });

  try {
    await waitForLocalPort(localPort, 45_000);
    portForwardHealthy = true;
    console.log(`[schema-mode pf] Port-forward established successfully`);
  } catch (e) {
    portForwardHealthy = false;
    const errorMsg = e instanceof Error ? e.message : String(e);
    console.error(
      `[schema-mode pf] Failed to establish port-forward: ${errorMsg}`,
    );
    if (outputLines.length > 0) {
      console.error(
        `[schema-mode pf] Port-forward output:\n${outputLines.join("\n")}`,
      );
    }
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    portForwardProcess = undefined;
    throw new Error(
      `Failed to establish port-forward to ${resource} in ${ns}.\n` +
        `Error: ${errorMsg}\n` +
        `Check that:\n` +
        `  - You are logged in to OpenShift (oc whoami)\n` +
        `  - Resource ${resource} exists in namespace ${ns}\n` +
        `  - Resource is in Running state`,
    );
  }

  process.env.SCHEMA_MODE_DB_HOST = "localhost";

  return {
    stop: () => {
      console.log("[schema-mode pf] Stopping port-forward");
      portForwardHealthy = false;
      if (portForwardProcess) {
        try {
          portForwardProcess.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        portForwardProcess = undefined;
      }
    },
    isHealthy: () => {
      return (
        portForwardHealthy &&
        portForwardProcess !== undefined &&
        !portForwardProcess.killed
      );
    },
  };
}
