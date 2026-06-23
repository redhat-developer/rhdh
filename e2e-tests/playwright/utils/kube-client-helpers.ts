import * as k8s from "@kubernetes/client-node";
import { getErrorMessage, hasErrorResponse, hasStatusCode } from "./errors";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Structured result from checkPodFailureStates() containing both
 * a human-readable message and the failing container name (if applicable).
 */
export interface PodFailureResult {
  /** Human-readable description of the failure */
  message: string;
  /** The name of the failing container, if the failure is container-scoped */
  containerName?: string;
}

export const APP_CONFIG_NAMES = [
  "app-config-rhdh",
  "app-config",
  "backstage-app-config",
  "rhdh-app-config",
] as const;

export const DEFAULT_BACKSTAGE_LABEL_SELECTOR =
  "app.kubernetes.io/component=backstage,app.kubernetes.io/instance=rhdh,app.kubernetes.io/name=backstage";

export function getErrorStatusCode(error: unknown): number | undefined {
  if (hasErrorResponse(error) && error.response?.statusCode !== undefined) {
    return error.response.statusCode;
  }
  if (hasStatusCode(error)) {
    return error.statusCode;
  }
  return undefined;
}

export function getErrorBodyMessage(error: unknown): string | undefined {
  if (
    hasErrorResponse(error) &&
    typeof error.body?.message === "string" &&
    error.body.message !== ""
  ) {
    return error.body.message;
  }
  return undefined;
}

export function formatKubeErrorLog(error: unknown): string {
  return getErrorBodyMessage(error) ?? getKubeApiErrorMessage(error);
}

export function getEventSortTimestamp(event: k8s.CoreV1Event): number {
  if (event.firstTimestamp !== undefined) {
    return typeof event.firstTimestamp === "string"
      ? new Date(event.firstTimestamp).getTime()
      : event.firstTimestamp.getTime();
  }
  if (event.eventTime !== undefined) {
    return typeof event.eventTime === "string"
      ? new Date(event.eventTime).getTime()
      : event.eventTime.getTime();
  }
  return 0;
}

export function formatEventTimestamp(event: k8s.CoreV1Event): string {
  if (event.firstTimestamp !== undefined) {
    return typeof event.firstTimestamp === "string"
      ? new Date(event.firstTimestamp).toISOString()
      : event.firstTimestamp.toISOString();
  }
  if (event.eventTime !== undefined) {
    return typeof event.eventTime === "string"
      ? new Date(event.eventTime).toISOString()
      : event.eventTime.toISOString();
  }
  return "unknown";
}

export function formatContainerStartedAt(
  startedAt: Date | string | undefined,
): string {
  if (startedAt === undefined || startedAt === "") {
    return "unknown";
  }
  return typeof startedAt === "string"
    ? new Date(startedAt).toISOString()
    : startedAt.toISOString();
}

/**
 * Safely extracts error information from Kubernetes API errors without leaking sensitive data.
 */
export function getKubeApiErrorMessage(error: unknown): string {
  if (hasErrorResponse(error)) {
    const body: unknown = error.body;
    if (isRecord(body) && typeof body.message === "string") {
      const parts = [body.message];
      if (typeof body.reason === "string") {
        parts.push(`reason: ${body.reason}`);
      }
      if (typeof body.code === "number") {
        parts.push(`code: ${String(body.code)}`);
      }
      return parts.join(", ");
    }

    const response: unknown = error.response;
    if (isRecord(response) && typeof response.statusCode === "number") {
      const statusMessage =
        typeof response.statusMessage === "string"
          ? response.statusMessage
          : "Unknown error";
      return `HTTP ${String(response.statusCode)}: ${statusMessage}`;
    }
  }

  if (hasStatusCode(error)) {
    return `HTTP ${String(error.statusCode)}`;
  }

  if (error instanceof Error) {
    return error.message;
  }

  const message = getErrorMessage(error);
  return message === "" ? "Unknown Kubernetes API error" : message;
}

/**
 * Returns the RHDH deployment name based on the install method.
 */
export function getRhdhDeploymentName(): string {
  const releaseName =
    process.env.RELEASE_NAME !== undefined && process.env.RELEASE_NAME !== ""
      ? process.env.RELEASE_NAME
      : "rhdh";
  const job = process.env.JOB_NAME ?? "";
  if (job.includes("operator")) {
    return `backstage-${releaseName}`;
  }
  return `${releaseName}-developer-hub`;
}

export function rejectAsError(
  reject: (reason: Error) => void,
  err: unknown,
): void {
  reject(err instanceof Error ? err : new Error(getErrorMessage(err)));
}

export function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      resolve();
    }, ms);
  });
}

export function podNameOrUnknown(name: string | undefined): string {
  return name !== undefined && name !== "" ? name : "unknown";
}
