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
          rejectUnauthorized: false,
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

    const certInfo = await new Promise<{
      sigAlg: string;
      subject: string;
      issuer: string;
    }>((resolve, reject) => {
      const socket = tls.connect(
        port,
        host,
        {
          servername: host,
          rejectUnauthorized: false,
        },
        () => {
          const cert = socket.getPeerCertificate();

          const certKeys = Object.keys(cert);
          if (certKeys.length === 0) {
            socket.end();
            reject(new Error("No certificate received from server"));
            return;
          }

          interface CertWithSigAlg {
            sigalg?: string;
            subject?: Record<string, unknown>;
            issuer?: Record<string, unknown>;
          }

          const certTyped = cert as CertWithSigAlg;
          const sigAlg = typeof certTyped.sigalg === "string" ? certTyped.sigalg : "unknown";

          const subject =
            typeof certTyped.subject === "object" && certTyped.subject !== null
              ? Object.entries(certTyped.subject)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(", ")
              : "unknown";

          const issuer =
            typeof certTyped.issuer === "object" && certTyped.issuer !== null
              ? Object.entries(certTyped.issuer)
                  .map(([k, v]) => `${k}=${String(v)}`)
                  .join(", ")
              : "unknown";

          socket.end();
          resolve({
            sigAlg: sigAlg,
            subject: subject,
            issuer: issuer,
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

    console.log(`[FIPS] Certificate Subject: ${certInfo.subject}`);
    console.log(`[FIPS] Certificate Issuer: ${certInfo.issuer}`);
    console.log(`[FIPS] Certificate Signature Algorithm: ${certInfo.sigAlg}`);

    expect(certInfo.sigAlg.toLowerCase()).toMatch(/sha(256|384|512)/iu);
    expect(certInfo.sigAlg.toLowerCase()).not.toMatch(/md5/iu);
    expect(certInfo.sigAlg.toLowerCase()).not.toMatch(/sha1(?!with)/iu);
  });
});
