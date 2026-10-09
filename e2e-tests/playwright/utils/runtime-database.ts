import { Client, type QueryConfig } from "pg";

import { sleep } from "./poll-until";
import { readCertificateFile } from "./postgres-config";

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

export function readExternalDatabaseInputs(
  provider: ExternalDatabaseProvider,
  slot: number,
  env: NodeJS.ProcessEnv = process.env,
): ExternalDatabaseInputs | null {
  if (![1, 2, 3, 4].includes(slot)) throw new Error("External database slot must be 1..4");
  const root = provider === "rds" ? "RDS" : "AZURE_DB";
  const host = env[`${root}_${slot}_HOST`]?.trim();
  if (host === undefined || host === "") return null;
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
          do {
            sessions = (
              await query(
                "SELECT pid, datname, backend_type, state, wait_event_type, wait_event FROM pg_stat_activity WHERE starts_with(datname, $1)",
                [prefix],
                true,
              )
            ).rows;
            if (sessions.some((session) => !session.datname.startsWith(prefix)))
              throw new Error("Session escaped runtime ownership boundary", { cause: error });
            // Backends can linger after pod termination. Do not signal privileged processes.
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
    const client = new Client({
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
