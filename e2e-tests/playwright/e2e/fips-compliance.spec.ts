import * as fs from "fs";
import * as tls from "tls";
import * as url from "url";

import { test, expect } from "@support/coverage/test";
import Redis from "ioredis";

import { PortForwardHarness } from "../support/harnesses/port-forward-harness";

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

  test("Redis TLS connection works", async () => {
    const REDIS_LOCAL_PORT = 16_379;
    let portForward: PortForwardHarness | null = null;
    let redis: Redis | null = null;

    try {
      // Setup port-forward to Redis
      portForward = new PortForwardHarness(
        {
          shellCommand: `
            oc login --token="${process.env.K8S_CLUSTER_TOKEN}" --server="${process.env.K8S_CLUSTER_URL}" --insecure-skip-tls-verify=true &&
            kubectl config set-context --current --namespace="${process.env.NAME_SPACE}" &&
            kubectl port-forward service/redis ${REDIS_LOCAL_PORT}:6379 --namespace="${process.env.NAME_SPACE}"
          `,
        },
        {
          readyPattern: /Forwarding from/u,
          readyTimeoutMs: 60_000,
        },
      );

      await portForward.start();

      // Connect to Redis with TLS and proper certificate verification
      const redisUrl = `rediss://${process.env.REDIS_USERNAME}:${process.env.REDIS_PASSWORD}@localhost:${REDIS_LOCAL_PORT}`;

      // Read CA certificate from NODE_EXTRA_CA_CERTS (contains FIPS CA + Crunchy CA)
      const caCertPath = process.env.NODE_EXTRA_CA_CERTS;
      if (caCertPath === undefined || caCertPath === "") {
        throw new Error("NODE_EXTRA_CA_CERTS not set - required for Redis TLS verification");
      }

      const caCert = fs.readFileSync(caCertPath);

      const redisOptions = {
        tls: {
          // Verify certificate against FIPS CA
          ca: caCert,
          // Set servername to match certificate SAN (port-forward uses localhost)
          servername: "redis",
        },
      };

      console.log("[FIPS] Connecting to Redis with TLS...");
      const client = new Redis(redisUrl, redisOptions);
      redis = client;

      // Verify connection with PING
      const response = await client.ping();
      console.log(`[FIPS] Redis PING response: ${response}`);

      expect(response).toBe("PONG");

      // Redis only accepts TLS (--port 0), so any key present was written by
      // the RHDH backend over TLS. An empty DB means RHDH is not using the cache.
      await expect
        .poll(() => client.dbsize(), {
          message: "RHDH backend should write cache entries to Redis over TLS",
          timeout: 60_000,
        })
        .toBeGreaterThan(0);
    } finally {
      if (redis?.status === "ready") {
        redis.disconnect();
      }
      if (portForward) {
        await portForward.stop();
      }
    }
  });
});
