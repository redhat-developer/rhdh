import { test, expect } from "@support/coverage/test";
import * as tls from "tls";
import * as url from "url";

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

    const sigAlg = execSync("openssl x509 -noout -text", {
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
