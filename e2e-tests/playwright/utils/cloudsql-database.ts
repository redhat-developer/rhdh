import { Client } from "pg";

import { buildCloudSqlProxy, buildCloudSqlProxyVolume } from "./cloudsql-config";
import { KubeClient } from "./kube-client";
import { pollUntil } from "./poll-until";
import { PortForwardSession } from "./port-forward";

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

  async start(instance: string, statementTimeoutMs = 30_000): Promise<Client> {
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
    const client = await this.connect("postgres", statementTimeoutMs);
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

  async connect(database = "postgres", statementTimeoutMs = 30_000): Promise<Client> {
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
      statement_timeout: statementTimeoutMs,
      query_timeout: statementTimeoutMs + 10_000,
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
