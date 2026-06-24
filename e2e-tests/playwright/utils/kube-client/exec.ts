import * as stream from "stream";

import * as k8s from "@kubernetes/client-node";

import { getKubeApiErrorMessage } from "./helpers";

function createOutputCaptureStreams(): {
  capture: { stdout: string; stderr: string };
  stdoutStream: stream.Writable;
  stderrStream: stream.Writable;
} {
  const capture = {
    stdout: "",
    stderr: "",
  };

  const stdoutStream = new stream.Writable({
    write(chunk: Buffer, encoding: string, callback: () => void) {
      capture.stdout += chunk.toString();
      callback();
    },
  });
  const stderrStream = new stream.Writable({
    write(chunk: Buffer, encoding: string, callback: () => void) {
      capture.stderr += chunk.toString();
      callback();
    },
  });

  return { capture, stdoutStream, stderrStream };
}

function buildExecFailureMessage(status: k8s.V1Status, stderr: string): string {
  const statusMessage =
    status.message !== undefined && status.message !== "" ? status.message : undefined;
  const stderrMessage = stderr === "" ? "unknown error" : stderr;
  return statusMessage ?? stderrMessage;
}

export async function execPodCommandImpl(
  kc: k8s.KubeConfig,
  podName: string,
  namespace: string,
  containerName: string,
  command: string[],
  timeout: number = 60000,
): Promise<{ stdout: string; stderr: string }> {
  try {
    const exec = new k8s.Exec(kc);
    const capture = createOutputCaptureStreams();

    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Command execution timed out after ${timeout}ms`));
      }, timeout);

      void exec.exec(
        namespace,
        podName,
        containerName,
        command,
        capture.stdoutStream,
        capture.stderrStream,
        null,
        false,
        (status: k8s.V1Status) => {
          clearTimeout(timeoutId);
          if (status.status === "Success") {
            resolve();
          } else {
            reject(
              new Error(
                `Command execution failed: ${buildExecFailureMessage(status, capture.capture.stderr)}`,
              ),
            );
          }
        },
      );
    });

    return { stdout: capture.capture.stdout, stderr: capture.capture.stderr };
  } catch (error) {
    throw new Error(
      `Failed to execute command in pod ${podName}: ${getKubeApiErrorMessage(error)}`,
      { cause: error },
    );
  }
}
