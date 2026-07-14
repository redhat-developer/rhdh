/** Safely extract a message from an unknown caught value. */
export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Type guard for errors with an HTTP-style response (Kubernetes client, etc.). */
export function hasErrorResponse(error: unknown): error is {
  response?: { statusCode?: number };
  body?: { message?: string };
} {
  return typeof error === "object" && error !== null;
}

/** Type guard for errors with a top-level statusCode (Microsoft Graph SDK, etc.). */
export function hasStatusCode(error: unknown): error is { statusCode: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error &&
    typeof (error as { statusCode: unknown }).statusCode === "number"
  );
}

/** True for Kubernetes AlreadyExists / conflict responses (create-or-replace paths). */
export function isKubernetesConflictError(error: unknown): boolean {
  if (hasStatusCode(error) && error.statusCode === 409) {
    return true;
  }
  return hasErrorResponse(error) && error.response?.statusCode === 409;
}
