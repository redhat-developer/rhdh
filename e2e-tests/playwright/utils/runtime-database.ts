import { Client } from "pg";

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
  const user = env[`${root}_USER`];
  const password = env[`${root}_PASSWORD`];
  const caPath =
    env[provider === "rds" ? "RDS_DB_CERTIFICATES_PATH" : "AZURE_DB_CERTIFICATES_PATH"];
  const anyHost = [1, 2, 3, 4].some(
    (index) => (env[`${root}_${index}_HOST`]?.trim().length ?? 0) > 0,
  );
  if (!anyHost) return null;
  if (
    host === undefined ||
    host === "" ||
    user === undefined ||
    user === "" ||
    password === undefined ||
    password === ""
  ) {
    throw new Error(`Required ${provider} slot ${slot} needs host, user and password`);
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
  query(text: string, values?: string[]): Promise<{ rows: Array<{ datname: string }> }>;
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
): Promise<void> {
  for (const name of await listOwnedDatabases(client, prefix)) {
    if (!name.startsWith(prefix)) throw new Error("Database escaped runtime ownership boundary");
    const quoted = `"${name.replaceAll('"', '""')}"`;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await client.query(`DROP DATABASE IF EXISTS ${quoted}`);
        break;
      } catch (error) {
        const busy =
          typeof error === "object" && error !== null && Reflect.get(error, "code") === "55006";
        if (!busy || attempt === 9)
          throw new Error(`Failed to drop owned database ${name}`, { cause: error });
        await sleep(2_000);
      }
    }
  }
  if ((await listOwnedDatabases(client, prefix)).length > 0)
    throw new Error(`Database cleanup left resources for ${prefix}`);
}

export async function connectExternalDatabase(
  inputs: ExternalDatabaseInputs,
  database = "postgres",
  statementTimeoutMs = 30_000,
): Promise<Client> {
  const client = new Client({
    host: inputs.host,
    port: inputs.port,
    user: inputs.user,
    password: inputs.password,
    database,
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
    throw error;
  }
}
