import { randomBytes } from "node:crypto";

import type { Client, QueryConfig } from "pg";

import { sleep } from "./poll-until";
import { readCertificateFile } from "./postgres-config";
import { RuntimeSqlClient } from "./runtime-sql-client";

export type ExternalDatabaseProvider = "rds" | "azure";
/** DROP DATABASE can checkpoint storage on small managed instances; bound DDL separately from reads. */
export const RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS = 180_000;
export interface ExternalDatabaseInputs {
  host: string;
  port: number;
  user: string;
  password: string;
  certificate: string;
}

function slotHost(
  provider: ExternalDatabaseProvider,
  slot: number,
  env: NodeJS.ProcessEnv,
): string | null {
  const host = env[`${provider === "rds" ? "RDS" : "AZURE_DB"}_${slot}_HOST`]?.trim();
  return host === undefined || host === "" ? null : host;
}

/** Provider-wide checks run once, on whichever slot is configured first. */
export function firstConfiguredExternalDatabaseSlot(
  provider: ExternalDatabaseProvider,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  return [1, 2, 3, 4].find((slot) => slotHost(provider, slot, env) !== null) ?? null;
}

export function readExternalDatabaseInputs(
  provider: ExternalDatabaseProvider,
  slot: number,
  env: NodeJS.ProcessEnv = process.env,
): ExternalDatabaseInputs | null {
  if (![1, 2, 3, 4].includes(slot)) throw new Error("External database slot must be 1..4");
  const root = provider === "rds" ? "RDS" : "AZURE_DB";
  const host = slotHost(provider, slot, env);
  if (host === null) return null;
  const user = env[`${root}_USER`];
  const password = env[`${root}_PASSWORD`];
  const caPath =
    env[provider === "rds" ? "RDS_DB_CERTIFICATES_PATH" : "AZURE_DB_CERTIFICATES_PATH"];
  if (user === undefined || user === "" || password === undefined || password === "") {
    throw new Error(`Configured ${provider} slot ${slot} needs user and password`);
  }
  const certificate = readCertificateFile(caPath);
  if (certificate === null || !certificate.includes("-----BEGIN CERTIFICATE-----"))
    throw new Error(`${provider} requires a readable PostgreSQL CA bundle`);
  return { host, port: 5432, user, password, certificate };
}

export function runtimeDatabasePrefix(
  runId: string,
  provider: ExternalDatabaseProvider,
  slot: number,
): string {
  if (!/^[a-f0-9]{12}$/u.test(runId) || ![1, 2, 3, 4].includes(slot))
    throw new Error("Invalid runtime database ownership");
  return `rt_${runId}_${provider}${slot}_`;
}

/** Longer than any job that runs these tests; a younger run on the slot may still be live. */
export const RUNTIME_RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

/** Leading hex chars of a run id that hold its start time in seconds; the rest are random. */
const RUN_ID_TIME_HEX_CHARS = 8;

/** Start time first, so other runs on the slot can read this run's age from its prefix. */
export function newRuntimeRunId(now = Date.now()): string {
  const seconds = Math.floor(now / 1000)
    .toString(16)
    .padStart(RUN_ID_TIME_HEX_CHARS, "0");
  return `${seconds}${randomBytes(2).toString("hex")}`;
}

function runStartedAt(prefix: string): number {
  const runId = /_([a-f0-9]{12})_/u.exec(prefix)?.[1] ?? "";
  return Number.parseInt(runId.slice(0, RUN_ID_TIME_HEX_CHARS), 16) * 1000;
}

export interface OwnedDatabaseClient {
  query(
    text: string | (QueryConfig<string[]> & { query_timeout: number }),
    values?: string[],
  ): Promise<{ rows: Array<{ datname: string }> }>;
}

export function assertOwnedDatabasePrefix(prefix: string): void {
  if (!/^(?:csql_[a-f0-9]{12}_[1-4]_|rt_[a-f0-9]{12}_(?:rds|azure)[1-4]_)$/u.test(prefix)) {
    throw new Error("Refusing database cleanup without an exact run/slot prefix");
  }
}

export async function listOwnedDatabases(
  client: OwnedDatabaseClient,
  prefix: string,
): Promise<string[]> {
  assertOwnedDatabasePrefix(prefix);
  const result = await client.query(
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND starts_with(datname, $1)",
    [prefix],
  );
  return result.rows.map((row) => row.datname);
}

export async function clearOwnedDatabases(
  client: OwnedDatabaseClient,
  prefix: string,
  timeoutMs = RUNTIME_DATABASE_CLEANUP_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const query = (text: string, values?: string[], read = false) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`Database cleanup deadline exceeded for ${prefix}`);
    return client.query({
      text,
      values,
      query_timeout: Math.min(remaining, read ? 10_000 : remaining),
    });
  };
  const reads: OwnedDatabaseClient = {
    query: (text, values) =>
      typeof text === "string" ? query(text, values, true) : query(text.text, text.values, true),
  };
  // Writers must be stopped first. FORCE can try to signal privileged Cloud SQL
  // processes that ordinary database owners cannot terminate.
  for (const name of await listOwnedDatabases(reads, prefix)) {
    if (!name.startsWith(prefix)) throw new Error("Database escaped runtime ownership boundary");
    const quoted = `"${name.replaceAll('"', '""')}"`;
    for (;;) {
      try {
        // Bound the server too: a client timeout alone does not cancel a checkpointing DROP.
        await query(
          "SELECT set_config('statement_timeout', $1, false)",
          [String(Math.max(1, deadline - Date.now()))],
          true,
        );
        await query(`DROP DATABASE IF EXISTS ${quoted}`);
        break;
      } catch (error) {
        const busy =
          typeof error === "object" && error !== null && Reflect.get(error, "code") === "55006";
        if (!busy) throw new Error(`Failed to drop owned database ${name}`, { cause: error });
        let sessions: Array<{ datname: string }> = [];
        try {
          // Backends of a stopped pod can outlive it until TCP keepalive. Ending this role's own
          // sessions needs no privilege and never signals the provider's processes.
          await query(
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND usename = current_user AND pid <> pg_backend_pid()",
            [name],
          );
          do {
            sessions = (
              await query(
                "SELECT pid, datname, usename, backend_type, state, wait_event_type, wait_event FROM pg_stat_activity WHERE starts_with(datname, $1)",
                [prefix],
                true,
              )
            ).rows;
            if (sessions.some((session) => !session.datname.startsWith(prefix)))
              throw new Error("Session escaped runtime ownership boundary", { cause: error });
            // Other roles' sessions are left to end on their own.
            await sleep(Math.min(2_000, Math.max(0, deadline - Date.now())));
          } while (sessions.length > 0 && Date.now() < deadline);
          if (Date.now() >= deadline)
            throw new Error("Owned database sessions did not drain", { cause: error });
        } catch (drainError) {
          throw new AggregateError(
            [error, drainError],
            `Failed to drop owned database ${name}; remaining sessions: ${JSON.stringify(sessions)}`,
            { cause: drainError },
          );
        }
      }
    }
  }
  if ((await listOwnedDatabases(reads, prefix)).length > 0)
    throw new Error(`Database cleanup left resources for ${prefix}`);
}

/** Teardown drop on a dedicated admin connection, closed whatever the outcome. */
export async function dropOwnedDatabases(
  connect: () => Promise<OwnedDatabaseClient & { end(): Promise<void> }>,
  prefix: string,
): Promise<void> {
  const client = await connect();
  try {
    await clearOwnedDatabases(client, prefix);
  } finally {
    try {
      await client.end();
    } catch (error) {
      // Closing must not hide a DROP error or mark a completed drop as incomplete.
      console.warn(
        `Runtime database cleanup connection for ${prefix} failed to close: ${String(error)}`,
      );
    }
  }
}

export interface SlotCleanup {
  retired: string[];
  failed: string[];
  /** Other runs on this slot young enough to still be running; left untouched. */
  active: string[];
}

/**
 * Clear this slot's databases left by earlier, interrupted runs, then the current run's.
 * Nightlies and PR jobs on every branch share the database hosts, so another run on the slot
 * may still be live: only runs older than RUNTIME_RUN_MAX_AGE_MS are retired.
 */
export async function clearSlotDatabases(
  client: OwnedDatabaseClient,
  currentPrefix: string,
  now = Date.now(),
): Promise<SlotCleanup> {
  assertOwnedDatabasePrefix(currentPrefix);
  // rt_<run>_rds1_ -> ^rt_[a-f0-9]{12}_rds1_ ; csql_<run>_1_ -> ^csql_[a-f0-9]{12}_1_
  const slotPattern = `^${currentPrefix.replace(/_[a-f0-9]{12}_/u, "_[a-f0-9]{12}_")}`;
  const { rows } = await client.query({
    text: "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname ~ $1",
    values: [slotPattern],
    query_timeout: 10_000,
  });
  const matcher = new RegExp(slotPattern, "u");
  const otherRuns = new Set(
    rows
      .map((row) => row.datname)
      .filter((name) => matcher.test(name))
      .map((name) => name.slice(0, currentPrefix.length))
      .filter((prefix) => prefix !== currentPrefix),
  );
  const cleanup: SlotCleanup = { retired: [], failed: [], active: [] };
  for (const prefix of otherRuns) {
    // Either sign: a run on a node whose clock is ahead looks like it starts in the future.
    if (Math.abs(now - runStartedAt(prefix)) < RUNTIME_RUN_MAX_AGE_MS) {
      cleanup.active.push(prefix);
      continue;
    }
    try {
      await clearOwnedDatabases(client, prefix);
      cleanup.retired.push(prefix);
    } catch (error) {
      // Another run's leftovers must not fail this run; the next run on the slot retries.
      console.warn(`Could not retire stale runtime databases ${prefix}: ${String(error)}`);
      cleanup.failed.push(prefix);
    }
  }
  await clearOwnedDatabases(client, currentPrefix);
  return cleanup;
}

/** Finish every close attempt before cleanup, even if an individual connection fails. */
export async function closeDatabaseClients(clients: Set<{ end(): Promise<void> }>): Promise<void> {
  const results = await Promise.allSettled([...clients].map((client) => client.end()));
  clients.clear();
  const errors = results
    .filter((result) => result.status === "rejected")
    .map((result) => {
      const reason: unknown = result.reason;
      return reason;
    });
  if (errors.length > 0) throw new AggregateError(errors, "Runtime SQL clients failed to close");
}

export async function connectExternalDatabase(
  inputs: ExternalDatabaseInputs,
  database = "postgres",
  statementTimeoutMs = 30_000,
): Promise<Client> {
  for (let attempt = 0; ; attempt++) {
    const client = new RuntimeSqlClient({
      host: inputs.host,
      port: inputs.port,
      user: inputs.user,
      password: inputs.password,
      database,
      application_name: "rhdh-runtime-probe",
      ssl: { ca: inputs.certificate, rejectUnauthorized: true },
      connectionTimeoutMillis: 30_000,
      statement_timeout: statementTimeoutMs,
      query_timeout: statementTimeoutMs + 10_000,
    });
    client.on("error", () => {});
    try {
      await client.connect();
      return client;
    } catch (error) {
      await client.end();
      // Retry only transport establishment, never SQL or invalid credentials/certificates.
      const code: unknown =
        typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
      const timedOut = error instanceof Error && error.message === "timeout expired";
      if (attempt >= 2 || (!timedOut && code !== "ETIMEDOUT" && code !== "ECONNRESET")) throw error;
      await sleep(2_000);
    }
  }
}
