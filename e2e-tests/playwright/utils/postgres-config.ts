import { readFileSync, existsSync } from "node:fs";

/** Application connection keys shared by schema-mode and runtime PostgreSQL. */
export const POSTGRES_ENV_KEYS = [
  "POSTGRES_HOST",
  "POSTGRES_PORT",
  "POSTGRES_DB",
  "POSTGRES_USER",
  "POSTGRES_PASSWORD",
] as const;

/** Certificate files from the E2E secret collection can contain escaped newlines. */
export function readCertificateFile(filePath: string | undefined): string | null {
  if (filePath === undefined || filePath === "") return null;
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath, "utf8").replaceAll("\\n", "\n");
}
