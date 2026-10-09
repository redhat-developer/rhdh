import type { TestInfo } from "@playwright/test";

import { base64Encode, run } from "./helper";
import { KubeClient, getErrorStatusCode, getRhdhDeploymentName } from "./kube-client";
import { pollUntil } from "./poll-until";
import type { RuntimeDeployConfig } from "./runtime-config";
import { deployRuntime } from "./runtime-deploy";
import { stopRuntimeApplication, setRuntimeReplicas, runtimeRevision } from "./runtime-lifecycle";

/** Exercise the running backend's trust configuration, not just a test-runner pg client. */
export async function verifyRuntimeRejectsUntrustedCa(
  kube: KubeClient,
  config: RuntimeDeployConfig,
  method: "helm" | "operator",
  certificate: string,
  info: Pick<TestInfo, "attach">,
  redact: (text: string) => string,
): Promise<void> {
  // OpenSSL is present in the E2E image; discard the generated key without writing it to disk.
  const untrustedCa = await run("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    "/dev/null",
    "-out",
    "/dev/stdout",
    "-days",
    "1",
    "-subj",
    "/CN=RHDH unrelated test CA",
  ]);
  const { namespace, releaseName } = config;
  const deploymentName = getRhdhDeploymentName(method, releaseName);
  const setCa = (value: string) =>
    kube.createOrUpdateSecret(
      {
        metadata: { name: "postgres-crt" },
        data: { "postgres-crt.pem": base64Encode(value) },
      },
      namespace,
    );
  await stopRuntimeApplication(kube, namespace, releaseName, method);
  const errors: unknown[] = [];
  let evidence = "";
  try {
    await setCa(untrustedCa);
    await setRuntimeReplicas(kube, namespace, releaseName, method, 1);
    await pollUntil(
      async () => {
        const deployment = await kube.appsApi.readNamespacedDeployment(deploymentName, namespace);
        if ((deployment.body.status?.readyReplicas ?? 0) > 0) {
          throw new Error("RHDH became ready with an unrelated database CA");
        }
        const pods = await kube.coreV1Api.listNamespacedPod(namespace);
        for (const pod of pods.body.items) {
          const name = pod.metadata?.name;
          if (name?.startsWith(`${deploymentName}-`) !== true) continue;
          for (const previous of [false, true]) {
            try {
              const logs = await kube.coreV1Api.readNamespacedPodLog(
                name,
                namespace,
                "backstage-backend",
                false,
                undefined,
                undefined,
                undefined,
                previous,
              );
              // An initializing container can return an empty response before it writes logs.
              const lines = (typeof logs.body === "string" ? logs.body : "")
                .split("\n")
                .filter(
                  (line) =>
                    /catalog|database|dynamic-features-resolver/iu.test(line) &&
                    /self.signed certificate|unable to verify.*certificate|unable to get.*issuer certificate|certificate.*(?:untrusted|verify failed)/iu.test(
                      line,
                    ),
                );
              if (lines.length > 0) {
                evidence = redact(lines.join("\n"));
                return true;
              }
            } catch (error) {
              if (![400, 404].includes(getErrorStatusCode(error) ?? 0)) throw error;
            }
          }
        }
        return false;
      },
      {
        timeoutMs: 180_000,
        intervalMs: 2_000,
        label: "Expected a database certificate-verification error from RHDH",
      },
    );
    await info.attach("runtime-database-untrusted-ca", {
      body: evidence,
      contentType: "text/plain",
    });
  } catch (error) {
    errors.push(error);
  }
  try {
    await stopRuntimeApplication(kube, namespace, releaseName, method);
    await setCa(certificate);
    config.revision = runtimeRevision();
    await deployRuntime(config, method, kube);
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "CA rejection check and recovery failed");
}
