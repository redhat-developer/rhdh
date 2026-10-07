import { Client } from "pg";

import { buildCloudSqlProxy, buildCloudSqlProxyVolume } from "./cloudsql-config";
import { KubeClient } from "./kube-client";
import { pollUntil, sleep } from "./poll-until";
import { PortForwardSession } from "./port-forward";

/** Validate ownership before any destructive SQL; LIKE would interpret our underscores as wildcards. */
export function assertCloudSqlPrefix(prefix: string): void {
  if (!/^csql_[a-f0-9]{12}_[1-4]_$/u.test(prefix)) {
    throw new Error("Refusing Cloud SQL cleanup without an exact run/slot database prefix");
  }
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

export interface CloudSqlCleanupClient {
  query(text: string, values?: string[]): Promise<{ rows: Array<{ datname: string }> }>;
}

export async function listCloudSqlDatabases(
  client: CloudSqlCleanupClient,
  prefix: string,
): Promise<string[]> {
  assertCloudSqlPrefix(prefix);
  const result = await client.query(
    "SELECT datname FROM pg_database WHERE NOT datistemplate AND starts_with(datname, $1)",
    [prefix],
  );
  return result.rows.map((row) => row.datname);
}

export async function clearCloudSqlDatabases(
  client: CloudSqlCleanupClient,
  prefix: string,
): Promise<void> {
  for (const database of await listCloudSqlDatabases(client, prefix)) {
    // Defense in depth: never trust a result outside the exact ownership boundary.
    if (!database.startsWith(prefix))
      throw new Error("Database escaped Cloud SQL ownership boundary");
    // Writers are stopped by the fixture. FORCE can try to signal Cloud SQL's
    // privileged background processes, which ordinary DB owners cannot terminate.
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await client.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(database)}`);
        break;
      } catch (error) {
        const busy =
          typeof error === "object" && error !== null && Reflect.get(error, "code") === "55006";
        if (!busy || attempt === 9) throw error;
        await sleep(2_000);
      }
    }
  }
  if ((await listCloudSqlDatabases(client, prefix)).length > 0) {
    throw new Error(`Cloud SQL cleanup left databases for ${prefix}`);
  }
}

/** Independent of the application pod, including while RHDH is stopped or broken. */
export class CloudSqlDatabaseSession {
  private tunnel?: PortForwardSession;
  private port?: number;
  private readonly clients = new Set<Client>();
  private started = false;
  readonly podName = "cloud-sql-cleanup";

  constructor(
    private readonly kubeClient: KubeClient,
    private readonly namespace: string,
    private readonly user: string,
    private readonly password: string,
  ) {}

  async start(instance: string): Promise<Client> {
    await this.kubeClient.coreV1Api.createNamespacedPod(this.namespace, {
      metadata: { name: this.podName, labels: { "rhdh.redhat.com/cloudsql-cleanup": "true" } },
      spec: {
        automountServiceAccountToken: false,
        containers: [buildCloudSqlProxy(instance, false)],
        volumes: [buildCloudSqlProxyVolume()],
      },
    });
    await pollUntil(
      async () => {
        const { body } = await this.kubeClient.coreV1Api.readNamespacedPod(
          this.podName,
          this.namespace,
        );
        return body.status?.containerStatuses?.some((container) => container.ready) === true;
      },
      { timeoutMs: 180_000, intervalMs: 2_000, label: "Cloud SQL cleanup proxy startup" },
    );

    this.tunnel = new PortForwardSession(
      {
        command: "oc",
        args: [
          "port-forward",
          "--address=127.0.0.1",
          "-n",
          this.namespace,
          `pod/${this.podName}`,
          ":5432",
        ],
      },
      { readyPattern: /Forwarding from 127\.0\.0\.1:\d+ -> 5432/u },
    );
    await this.startTunnel();
    const client = await this.connect();
    await client.query("SELECT 1");
    this.started = true;
    return client;
  }

  private async startTunnel(): Promise<void> {
    if (!this.tunnel) throw new Error("Cloud SQL cleanup tunnel has not been configured");
    await this.tunnel.start();
    const match = /Forwarding from 127\.0\.0\.1:(\d+) -> 5432/u.exec(this.tunnel.getOutput());
    if (!match) throw new Error("Could not discover Cloud SQL port-forward port");
    this.port = Number(match[1]);
  }

  async connect(database = "postgres"): Promise<Client> {
    if (this.started && this.tunnel) {
      try {
        this.tunnel.assertRunning();
      } catch {
        await this.tunnel.stop();
        await this.startTunnel();
      }
    }
    if (this.port === undefined) throw new Error("Cloud SQL cleanup tunnel has not started");
    const client = new Client({
      host: "127.0.0.1",
      port: this.port,
      user: this.user,
      password: this.password,
      database,
      ssl: false,
      connectionTimeoutMillis: 30_000,
      query_timeout: 30_000,
    });
    // pg emits asynchronous errors on an idle connection when a tunnel dies.
    client.on("error", () => {});
    this.clients.add(client);
    client.once("end", () => {
      this.clients.delete(client);
    });
    await client.connect();
    return client;
  }

  async close(): Promise<void> {
    try {
      await Promise.all([...this.clients].map((client) => client.end()));
    } finally {
      this.clients.clear();
      await this.tunnel?.stop();
    }
  }
}
