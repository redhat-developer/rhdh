/**
 * FIPS 140-3 (NIST) defines requirements for cryptographic modules. A system is compliant when
 * all its crypto runs through validated modules in FIPS mode, using only approved algorithms.
 * For TLS (NIST SP 800-52 Rev. 2):
 *   - Protocols: TLS 1.2 and 1.3 only.
 *   - Ciphers: AES-GCM (this spec allows only these). Not allowed: ChaCha20, RC4, 3DES.
 *   - Key exchange: ECDHE on P-256/P-384/P-521. Not allowed: X25519.
 *   - Certificates: ECDSA P-256+ or RSA 2048+, signed with SHA-256 or stronger.
 * On a FIPS OpenShift cluster, only images whose crypto library honours the kernel FIPS flag
 * (RHEL/UBI with system OpenSSL) run in FIPS mode, so each component is checked here.
 */
import * as fs from "fs";
import * as tls from "tls";
import * as url from "url";

import { test, expect } from "@support/coverage/test";
import Redis from "ioredis";
import { Client } from "pg";

import { PortForwardHarness } from "../support/harnesses/port-forward-harness";
import { base64Decode } from "../utils/helper";
import {
  BACKSTAGE_BACKEND_CONTAINER,
  getRhdhDeploymentName,
  KubeClient,
} from "../utils/kube-client";

test.describe("FIPS Compliance Validation", () => {
  test.beforeAll(({}, testInfo) => {
    testInfo.annotations.push({
      type: "component",
      description: "fips",
    });
  });

  test("RHDH route uses FIPS-approved TLS cipher suite", async () => {
    const baseUrl = process.env.BASE_URL;
    if (typeof baseUrl !== "string" || baseUrl === "") {
      throw new Error("BASE_URL environment variable is not set");
    }

    const parsedUrl = new url.URL(baseUrl);
    const host = parsedUrl.hostname;
    const port = parsedUrl.port === "" ? 443 : Math.trunc(Number(parsedUrl.port));

    const tlsInfo = await new Promise<{
      cipher: string;
      protocol: string;
      authorized: boolean;
    }>((resolve, reject) => {
      const socket = tls.connect(
        port,
        host,
        {
          servername: host,
          rejectUnauthorized: true,
        },
        () => {
          const cipher = socket.getCipher();
          const protocol = socket.getProtocol();
          const authorized = socket.authorized;

          socket.end();
          resolve({
            cipher: cipher.name,
            protocol: protocol ?? "unknown",
            authorized: authorized,
          });
        },
      );

      socket.on("error", (error) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        reject(new Error(`TLS connection failed: ${errorMessage}`));
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error("TLS connection timeout"));
      });
    });

    console.log(`[FIPS] Connected using cipher: ${tlsInfo.cipher}`);
    console.log(`[FIPS] TLS protocol: ${tlsInfo.protocol}`);
    console.log(`[FIPS] Certificate authorized: ${tlsInfo.authorized}`);

    expect(tlsInfo.cipher).toMatch(/AES/iu);
    expect(tlsInfo.cipher).toMatch(/(GCM|CBC)/iu);
    expect(tlsInfo.cipher).not.toMatch(/CHACHA20/iu);
    expect(tlsInfo.cipher).not.toMatch(/3DES/iu);
    expect(tlsInfo.cipher).not.toMatch(/RC4/iu);
    expect(tlsInfo.protocol).toMatch(/TLSv1\.[2-3]/u);
  });

  test("RHDH route refuses a non-FIPS cipher (ChaCha20)", async () => {
    const host = new url.URL(process.env.BASE_URL ?? "").hostname;

    // Offer only ChaCha20 (not FIPS-approved): a router in FIPS mode must refuse the handshake.
    const handshake = new Promise<string>((resolve, reject) => {
      const socket = tls.connect(
        {
          host,
          port: 443,
          servername: host,
          ciphers: "TLS_CHACHA20_POLY1305_SHA256",
          minVersion: "TLSv1.3",
          maxVersion: "TLSv1.3",
        },
        () => {
          const cipher = socket.getCipher().name;
          socket.end();
          resolve(cipher);
        },
      );
      socket.on("error", reject);
      socket.setTimeout(10_000, () => {
        socket.destroy();
        reject(new Error("TLS connection timeout"));
      });
    });

    await expect(handshake).rejects.toThrow(/handshake failure/iu);
  });

  test("RHDH route uses FIPS-approved certificate signature algorithm", async () => {
    const baseUrl = process.env.BASE_URL;
    if (typeof baseUrl !== "string" || baseUrl === "") {
      throw new Error("BASE_URL environment variable is not set");
    }

    const parsedUrl = new url.URL(baseUrl);
    const host = parsedUrl.hostname;
    const port = parsedUrl.port === "" ? 443 : Math.trunc(Number(parsedUrl.port));

    const certPem = await new Promise<string>((resolve, reject) => {
      const socket = tls.connect(
        port,
        host,
        {
          servername: host,
          rejectUnauthorized: true,
        },
        () => {
          const cert = socket.getPeerCertificate(false);

          const certKeys = Object.keys(cert);
          if (certKeys.length === 0) {
            socket.end();
            reject(new Error("No certificate received from server"));
            return;
          }

          const rawCert = cert.raw;
          if (typeof rawCert !== "object" || rawCert === null) {
            socket.end();
            reject(new Error("Certificate raw data not available"));
            return;
          }

          const pemCert = rawCert.toString("base64");
          const pemLines = pemCert.match(/.{1,64}/gu);
          if (pemLines === null || pemLines.length === 0) {
            socket.end();
            reject(new Error("Failed to format certificate"));
            return;
          }

          const pem = `-----BEGIN CERTIFICATE-----\n${pemLines.join("\n")}\n-----END CERTIFICATE-----`;

          socket.end();
          resolve(pem);
        },
      );

      socket.on("error", (error) => {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        reject(new Error(`TLS connection failed: ${errorMessage}`));
      });

      socket.setTimeout(10000, () => {
        socket.destroy();
        reject(new Error("TLS connection timeout"));
      });
    });

    const { execSync } = await import("child_process");

    const sigAlg =
      execSync("openssl x509 -noout -text", {
        input: certPem,
        encoding: "utf-8",
      })
        .split("\n")
        .find((line) => line.trim().startsWith("Signature Algorithm:"))
        ?.split(":")[1]
        ?.trim() ?? "unknown";

    const subject = execSync("openssl x509 -noout -subject -nameopt RFC2253", {
      input: certPem,
      encoding: "utf-8",
    })
      .replace("subject=", "")
      .trim();

    const issuer = execSync("openssl x509 -noout -issuer -nameopt RFC2253", {
      input: certPem,
      encoding: "utf-8",
    })
      .replace("issuer=", "")
      .trim();

    console.log(`[FIPS] Certificate Subject: ${subject}`);
    console.log(`[FIPS] Certificate Issuer: ${issuer}`);
    console.log(`[FIPS] Certificate Signature Algorithm: ${sigAlg}`);

    expect(sigAlg.toLowerCase()).toMatch(/sha(256|384|512)/iu);
    expect(sigAlg.toLowerCase()).not.toMatch(/md5/iu);
    expect(sigAlg.toLowerCase()).not.toMatch(/sha1(?!with)/iu);
  });
});

// FIPS 140-3 allow-list (OpenSSL names): TLS 1.2/1.3 with AES-GCM only.
const FIPS_PROTOCOLS = ["TLSv1.2", "TLSv1.3"];
const FIPS_CIPHERS = [
  "TLS_AES_128_GCM_SHA256",
  "TLS_AES_256_GCM_SHA384",
  "ECDHE-ECDSA-AES128-GCM-SHA256",
  "ECDHE-ECDSA-AES256-GCM-SHA384",
  "ECDHE-RSA-AES128-GCM-SHA256",
  "ECDHE-RSA-AES256-GCM-SHA384",
];

const POSTGRES_LOCAL_PORT = 15_432;
const REDIS_LOCAL_PORT = 16_379;

function portForward(ns: string, resource: string, localPort: number, remotePort: number) {
  return new PortForwardHarness(
    {
      shellCommand: `
        oc login --token="${process.env.K8S_CLUSTER_TOKEN}" --server="${process.env.K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &&
        oc port-forward ${resource} ${localPort}:${remotePort} --namespace="${ns}"
      `,
    },
    { readyPattern: /Forwarding from/u, readyTimeoutMs: 60_000 },
  );
}

test.describe("FIPS: RHDH, PostgreSQL and Redis", () => {
  test.describe.configure({ timeout: 180_000 });

  const namespace = process.env.NAME_SPACE ?? "";
  const pgNamespace =
    process.env.NAME_SPACE_POSTGRES_DB !== undefined && process.env.NAME_SPACE_POSTGRES_DB !== ""
      ? process.env.NAME_SPACE_POSTGRES_DB
      : "postgress-external-db";
  const redisUrl = `rediss://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@localhost:${REDIS_LOCAL_PORT}`;

  const kubeClient = new KubeClient();
  let pgPortForward: PortForwardHarness | null = null;
  let redisPortForward: PortForwardHarness | null = null;
  let pg: Client;
  let redisCa: Buffer;

  async function rhdhPod(): Promise<{ name: string; ip: string }> {
    const deployment = await kubeClient.appsApi.readNamespacedDeployment(
      getRhdhDeploymentName(),
      namespace,
    );
    const labelSelector = Object.entries(deployment.body.spec?.selector.matchLabels ?? {})
      .map(([key, value]) => `${key}=${value}`)
      .join(",");
    const pods = await kubeClient.coreV1Api.listNamespacedPod(
      namespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector,
    );
    const pod = pods.body.items.find((p) => p.status?.phase === "Running");
    if (pod?.metadata?.name === undefined || pod.status?.podIP === undefined) {
      throw new Error(`No running RHDH pod for selector "${labelSelector}"`);
    }
    return { name: pod.metadata.name, ip: pod.status.podIP };
  }

  test.beforeAll(async ({}, testInfo) => {
    testInfo.annotations.push({ type: "component", description: "fips" });

    // NODE_EXTRA_CA_CERTS is set by the FIPS job (FIPS CA, which signs the Redis cert).
    redisCa = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS ?? "");

    pgPortForward = portForward(
      pgNamespace,
      "svc/postgress-external-db-primary",
      POSTGRES_LOCAL_PORT,
      5432,
    );
    redisPortForward = portForward(namespace, "svc/redis", REDIS_LOCAL_PORT, 6379);
    await pgPortForward.start();
    await redisPortForward.start();

    // Same credentials RHDH uses.
    const secret = await kubeClient.getSecret("postgres-cred", namespace);
    pg = new Client({
      host: "localhost",
      port: POSTGRES_LOCAL_PORT,
      database: "postgres",
      user: base64Decode(secret.body.data?.POSTGRES_USER ?? ""),
      password: base64Decode(secret.body.data?.POSTGRES_PASSWORD ?? ""),
      // The test's own connection is not under test.
      ssl: { rejectUnauthorized: false },
    });
    await pg.connect();
  });

  test.afterAll(async () => {
    await pg.end();
    await pgPortForward?.stop();
    await redisPortForward?.stop();
  });

  test("RHDH backend runs in FIPS mode", async () => {
    const pod = await rhdhPod();
    const { stdout } = await kubeClient.execPodCommand(
      pod.name,
      namespace,
      BACKSTAGE_BACKEND_CONTAINER,
      ["node", "-p", "require('crypto').getFips()"],
    );

    expect(stdout.trim()).toBe("1");
  });

  test("PostgreSQL runs in FIPS mode", async () => {
    await pg.query("CREATE EXTENSION IF NOT EXISTS pgcrypto");
    const result = await pg.query<{ fips: boolean }>("SELECT fips_mode() AS fips");

    expect(result.rows[0]?.fips).toBe(true);
  });

  test("RHDH connections to PostgreSQL use FIPS-approved TLS", async () => {
    const result = await pg.query<{ ssl: boolean; version: string; cipher: string }>(
      `SELECT s.ssl, s.version, s.cipher
       FROM pg_stat_ssl s JOIN pg_stat_activity a USING (pid)
       WHERE a.usename = current_user AND a.pid <> pg_backend_pid()`,
    );
    console.log("[FIPS] RHDH PostgreSQL connections:", result.rows);

    expect(result.rows.length).toBeGreaterThan(0);
    for (const row of result.rows) {
      expect(row.ssl).toBe(true);
      expect(FIPS_PROTOCOLS).toContain(row.version);
      expect(FIPS_CIPHERS).toContain(row.cipher);
    }
  });

  test("Redis runs in FIPS mode (refuses ChaCha20)", async () => {
    const tlsOptions = { ca: redisCa, servername: "redis" };

    // Control: a normal TLS connection works.
    const control = new Redis(redisUrl, { tls: tlsOptions });
    expect(await control.ping()).toBe("PONG");
    control.disconnect();

    // Offering only ChaCha20 (not FIPS-approved) must be refused by the server.
    const chacha = new Redis(redisUrl, {
      tls: {
        ...tlsOptions,
        ciphers: "TLS_CHACHA20_POLY1305_SHA256",
        minVersion: "TLSv1.3",
        maxVersion: "TLSv1.3",
      },
      lazyConnect: true,
      retryStrategy: () => null,
    });
    await expect(chacha.connect()).rejects.toThrow(/handshake failure/iu);
    chacha.disconnect();
  });

  test("RHDH is connected to Redis", async () => {
    const pod = await rhdhPod();
    const redis = new Redis(redisUrl, { tls: { ca: redisCa, servername: "redis" } });

    try {
      await expect
        .poll(async () => String(await redis.call("CLIENT", "LIST")), { timeout: 120_000 })
        .toContain(`addr=${pod.ip}:`);
    } finally {
      redis.disconnect();
    }
  });

  test("RHDH connection to Redis uses FIPS-approved TLS", async () => {
    const pod = await rhdhPod();
    // Runs in the RHDH container: RHDH's own Node/OpenSSL and the Redis CA it mounts.
    const script = `
      const s = require("tls").connect(
        { host: "redis", port: 6379, servername: "redis",
          ca: require("fs").readFileSync("/opt/app-root/src/redis-ca.pem") },
        () => { console.log(s.getProtocol() + " " + s.getCipher().name); s.end(); });
      s.on("error", (e) => { console.error(e.message); process.exit(1); });`;
    const { stdout } = await kubeClient.execPodCommand(
      pod.name,
      namespace,
      BACKSTAGE_BACKEND_CONTAINER,
      ["node", "-e", script],
    );
    const [protocol, cipher] = stdout.trim().split(" ");
    console.log(`[FIPS] RHDH -> Redis: ${protocol} ${cipher}`);

    expect(FIPS_PROTOCOLS).toContain(protocol);
    expect(FIPS_CIPHERS).toContain(cipher);
  });
});
