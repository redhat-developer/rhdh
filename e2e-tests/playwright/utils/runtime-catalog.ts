import { randomBytes } from "node:crypto";

import type { V1Container } from "@kubernetes/client-node";
import * as yaml from "yaml";

import { base64Encode } from "./helper";
import { KubeClient } from "./kube-client";

export const RUNTIME_CATALOG_SOURCE = "runtime-catalog";
export const RUNTIME_CATALOG_SECRET = "runtime-catalog-token";
export const RUNTIME_CATALOG_TOKEN_KEY = "RUNTIME_CATALOG_API_TOKEN";
export const RUNTIME_CATALOG_URL = "http://127.0.0.1:8081/entity.yaml";
const entityPath = "/opt/app-root/src/runtime-catalog/entity.yaml";

/** Local, deterministic catalog input shared by all external database providers. */
export function buildRuntimeCatalogServer(image: string): V1Container {
  return {
    name: RUNTIME_CATALOG_SOURCE,
    image,
    command: [
      "node",
      "-e",
      `require('node:http').createServer((req, res) => {
      if (req.url !== '/entity.yaml') { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', 'text/yaml');
      res.end(require('node:fs').readFileSync('${entityPath}'));
    }).listen(8081, '0.0.0.0');`,
    ],
    volumeMounts: [
      {
        name: RUNTIME_CATALOG_SOURCE,
        mountPath: "/opt/app-root/src/runtime-catalog",
        readOnly: true,
      },
    ],
    readinessProbe: { httpGet: { path: "/entity.yaml", port: 8081 }, periodSeconds: 2 },
    securityContext: {
      runAsNonRoot: true,
      readOnlyRootFilesystem: true,
      allowPrivilegeEscalation: false,
      capabilities: { drop: ["ALL"] },
    },
    resources: { requests: { cpu: "50m", memory: "64Mi" } },
  };
}

export function runtimeCatalogAppConfig(backendSecret = "${BACKEND_SECRET}") {
  return {
    reading: { allow: [{ host: "127.0.0.1:8081" }] },
    auth: {
      externalAccess: [
        { type: "legacy", options: { subject: "legacy-default-config", secret: backendSecret } },
        {
          type: "static",
          options: { token: `\${${RUNTIME_CATALOG_TOKEN_KEY}}`, subject: "runtime-catalog-e2e" },
          accessRestrictions: [{ plugin: "catalog" }],
        },
      ],
    },
  };
}

export async function createRuntimeCatalogProbe(
  kube: KubeClient,
  namespace: string,
  entityName: string,
): Promise<{ entityName: string; apiToken: string }> {
  const apiToken = randomBytes(32).toString("hex");
  await kube.createOrUpdateSecret(
    {
      metadata: { name: RUNTIME_CATALOG_SECRET },
      data: { [RUNTIME_CATALOG_TOKEN_KEY]: base64Encode(apiToken) },
    },
    namespace,
  );
  await kube.createConfigMap(namespace, {
    metadata: { name: RUNTIME_CATALOG_SOURCE },
    data: {
      "entity.yaml": yaml.stringify({
        apiVersion: "backstage.io/v1alpha1",
        kind: "Component",
        // Let Catalog generate the UID: a recreated entity must not reuse a fixed identity.
        metadata: { name: entityName },
        spec: { type: "service", lifecycle: "experimental", owner: "guests" },
      }),
    },
  });
  return { entityName, apiToken };
}
