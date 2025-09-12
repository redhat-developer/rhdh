# Local development behind a corporate proxy

As mentioned in [Running the Showcase application behind a corporate proxy](corporate-proxy.md), the `HTTP(S)_PROXY` and `NO_PROXY` environment variables are supported.

If you are behind a corporate proxy and are running the Showcase locally with `yarn`, as depicted in [Running locally with a basic configuration](index.md#running-locally-with-a-basic-configuration) or [Running locally with the Optional Plugins](index.md#running-locally-with-the-optional-plugins), you will need to additionally set the `GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE` to an empty value prior to running `yarn start`.

Example:

```shell
$ GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE='' \
  HTTP_PROXY=http://localhost:3128 \
  HTTPS_PROXY=http://localhost:3128 \
  NO_PROXY='localhost,example.org' \
  yarn start
```

<!-- markdown-link-check-disable-next-line -->
You can use the command below to quickly start a local corporate proxy server (based on [Squid](https://www.squid-cache.org/)):

```shell
podman container run --rm --name squid-container \
  -e TZ=UTC \
  -p 3128:3128 \
  -it registry.redhat.io/rhel9/squid:latest
```

# Plugin vendors

The upstream Backstage project recommends the use of the `node-fetch` libraries in backend plugins for HTTP data fetching - see [ADR013](https://backstage.io/docs/architecture-decisions/adrs-adr013/).

We currently only support corporate proxy settings for the Axios, `fetch` and `node-fetch` libraries. Backend plugins using any of these libraries have nothing special to do to support corporate proxies.

Axios and `node-fetch` are supported with the proxy settings through the use of the [`global-agent`](https://github.com/gajus/global-agent#supported-libraries) package.
The native `fetch` library is supported with the proxy settings through the use of the Node's [`undici`](https://github.com/nodejs/undici) package.

# Logging

The following environment variables can be helpful when inspecting the behavior of the application with the proxy settings, for example to understand which requests are getting fetched through the proxy or directly bypassing the proxy.

- `ROARR_LOG`: setting it to `true` enables the `global-agent` logs. More details in https://github.com/gajus/global-agent#enable-logging
- `NODE_DEBUG`: setting it to `fetch` or `undici` enables debug statements for the native `fetch` calls. More details in https://github.com/nodejs/undici/blob/main/docs/docs/api/Debug.md

<details>

<summary>Example of logs</summary>

We can get an output like below with the following environment variables set:

- `NO_PROXY="localhost,.example.com"`
- `HTTP(S)_PROXY="http://proxy:3128"`
- `ROARR_LOG="true"`
- `NODE_DEBUG="fetch"`

```text
[...]
{"context":{"package":"global-agent","namespace":"createGlobalProxyAgent","logLevel":30,"configuration":{"environmentVariableNamespace":"","forceGlobalAgent":true,"socketConnectionTimeout":60
000},
  "state":{
    "HTTP_PROXY":"http://proxy:3128",
    "HTTPS_PROXY":"http://proxy:3128",
    "NO_PROXY":"localhost,.example.com"}
  },
  "message":"global agent has been initialized",
  "sequence":3,"time":1731063427425,"version":"1.0.0"}
[...]
{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"https://api.github.com/user",
  "proxy":"http://proxy:3128","requestId":2},
  "message":"proxying request",
  "sequence":28,"time":1731063460170,"version":"1.0.0"}

{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"http://10.10.10.105:8888/path/path1.yaml",
  "proxy":"http://proxy:3128","requestId":1},
  "message":"proxying request",
  "sequence":23,"time":1731065107588,"version":"1.0.0"}

[...]
{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"http://localhost:7007/api/catalog/.backstage/auth/v1/jwks.json"},
  "message":"not proxying request; url matches GLOBAL_AGENT.NO_PROXY",
  "sequence":4,"time":1731063026743,"version":"1.0.0"}

{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,"destination":"https://example.com/backstage/backstage/blob/master/packages/catalog-model/examples/all.yaml"},
  "message":"not proxying request; url matches GLOBAL_AGENT.NO_PROXY",
  "sequence":5,"time":1731063027049,"version":"1.0.0"}

{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"https://example.com:1234/backstage/backstage/blob/master/packages/catalog-model/examples/all.yaml"},
  "message":"not proxying request; url matches GLOBAL_AGENT.NO_PROXY",
  "sequence":6,"time":1731063027052,"version":"1.0.0"}

{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"https://subdomain.example.com/path/path1.yaml"},
  "message":"not proxying request; url matches GLOBAL_AGENT.NO_PROXY",
  "sequence":7,"time":1731063027053,"version":"1.0.0"}

{"context":{"package":"global-agent","namespace":"Agent","logLevel":10,
  "destination":"https://subdomain2.example.com/path/path1.yaml"},
  "message":"not proxying request; url matches GLOBAL_AGENT.NO_PROXY",
  "sequence":8,"time":1731063027055,"version":"1.0.0"}
[...]
FETCH 2: connecting to httpbin.org using https:undefined
FETCH 2: connecting to proxy:3128:3128 using http:undefined
FETCH 2: connected to proxy:3128:3128 using http:h1
FETCH 2: sending request to CONNECT http://proxy:3128/httpbin.org:443
FETCH 2: trailers received from GET https://httpbin.org//anything
FETCH 2: connected to proxy:3128:3128 using http:h1
[...]
FETCH 16: connected to localhost:7007:7007 using http:h1
FETCH 16: sending request to GET http://localhost:7007//api/catalog/.backstage/auth/v1/jwks.json
FETCH 16: received response to GET http://localhost:7007//api/catalog/.backstage/auth/v1/jwks.json - HTTP 200
FETCH 16: trailers received from GET http://localhost:7007//api/catalog/.backstage/auth/v1/jwks.json
[...]
```

</details>


# Testing

The most challenging part of writing an end-to-end test from the context of a corporate proxy is to set up an environment where an application is forbidden access to the public Internet except through that proxy.

## Locally with `podman-compose` or `docker-compose`

You can leverage the [`rhdh-local`](https://github.com/redhat-developer/rhdh-local) project to test how a given Showcase/Red Hat Developer Hub container image would behave when it is running behind a corporate proxy server. You would need either [`podman-compose`](https://docs.podman.io/en/latest/markdown/podman-compose.1.html) or [Docker Compose](https://docs.docker.com/compose/).

See [Testing RHDH in a simulated corporate proxy setup](https://github.com/redhat-developer/rhdh-local#testing-rhdh-in-a-simulated-corporate-proxy-setup) for more details.

## On a cluster

This approach simulates a corporate proxy environment in a Kubernetes/OpenShift namespace with the help of [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) to control ingress and egress traffic for pods within that namespace.

### Kubernetes

1. Make sure the network plugin in your Kubernetes cluster supports network policies. [k3d](https://k3d.io) for example supports Network Policies out of the box.

<!-- markdown-link-check-disable-next-line -->
2. Create a separate proxy namespace, and deploy a [Squid](https://www.squid-cache.org/)-based proxy application there. The full URL to access the proxy server from within the cluster would be `http://squid-service.proxy.svc.cluster.local:3128`.

```shell
kubectl create namespace proxy

cat <<EOF | kubectl -n proxy apply -f -
apiVersion: v1
kind: Service
metadata:
  name: squid-service
  labels:
    app: squid
spec:
  ports:
  - port: 3128
  selector:
    app: squid

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: squid-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: "squid"
  template:
    metadata:
      labels:
        app: squid
    spec:
      containers:
      - name: squid
        image: docker.io/ubuntu/squid:latest
        ports:
        - containerPort: 3128
          name: squid
          protocol: TCP
EOF
```

3. Create the namespace where the Showcase application will be running, e.g.:

```shell
kubectl create namespace my-ns
```

4. Add the network policies in the namespace above. The first one denies all egress traffic except to the DNS resolver and the Squid proxy. The second one allows ingress and egress traffic in the same namespace, because the Showcase app pod needs to contact the local Database pod.

```shell
cat <<EOF | kubectl -n my-ns apply -f -
---
# Deny all egress traffic in this namespace => proxy settings can be used to overcome this.
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: default-deny-egress-with-exceptions
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  # allow DNS resolution (we need this allowed, otherwise we won't be able to resolve the DNS name of the Squid proxy service)
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: kube-system
      podSelector:
        matchLabels:
          k8s-app: kube-dns
    ports:
      - port: 53
        protocol: UDP
      - port: 53
        protocol: TCP
  # allow traffic to Squid proxy
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: proxy
    ports:
    - port: 3128
      protocol: TCP

---
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: allow-same-namespace
spec:
  podSelector: {}
  ingress:
  - from:
    - podSelector: {}
  egress:
  - to:
    - podSelector: {}
EOF
```

5. Follow the instructions to add the proxy environment variables for an [Operator-based](corporate-proxy.md#operator-deployment) or [Helm-based](corporate-proxy.md#helm-deployment) deployment.

Example with a Custom Resource:

```yaml
apiVersion: rhdh.redhat.com/v1alpha1
kind: Backstage
metadata:
  name: my-rhdh
spec:
  application:
    # Support for Proxy settings added in PR 1225. Remove this once this PR is merged.
    # image: quay.io/rhdh-community/rhdh:pr-1225
    appConfig:
      configMaps:
        - name: app-config-rhdh
    dynamicPluginsConfigMapName: dynamic-plugins-rhdh
    extraEnvs:
      envs:
        - name: HTTP_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: HTTPS_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: NO_PROXY
          value: 'localhost'
        - name: ROARR_LOG
          # Logs from global-agent (to inspect proxy settings)
          value: 'true'
      secrets:
        - name: secrets-rhdh
# --- TRUNCATED ---
```

### OpenShift

<!-- markdown-link-check-disable-next-line -->
2. Create a separate proxy project, and deploy a [Squid](https://www.squid-cache.org/)-based proxy application there. The full URL to access the proxy server from within the cluster would be `http://squid-service.proxy.svc.cluster.local:3128`.

```shell
oc new-project proxy

cat <<EOF | kubectl -n proxy apply -f -
apiVersion: v1
kind: Service
metadata:
  name: squid-service
  labels:
    app: squid
spec:
  ports:
  - port: 3128
  selector:
    app: squid

---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: squid-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: "squid"
  template:
    metadata:
      labels:
        app: squid
    spec:
      containers:
      - name: squid
        image: registry.redhat.io/rhel9/squid:latest
        ports:
        - containerPort: 3128
          name: squid
          protocol: TCP
EOF
```

3. Create the namespace where the Showcase application will be running, e.g.:

```shell
oc new-project rhdh
```

4. Add the network policies in the namespace above. The first one denies all egress traffic except to the DNS resolver and the Squid proxy. The second one allows ingress and egress traffic in the same namespace, because the Showcase app pod needs to contact the local Database pod.

```shell
cat <<EOF | kubectl -n rhdh apply -f -
---
# Deny all egress traffic in this namespace => proxy settings can be used to overcome this.
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: default-deny-egress-with-exceptions
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  # allow DNS resolution (we need this allowed, otherwise we won't be able to resolve the DNS name of the Squid proxy service)
  - to:
    - podSelector: {}
      namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: openshift-dns
    ports:
      - port: 53
        protocol: UDP
      - port: 53
        protocol: TCP
  # allow traffic to Squid proxy
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: proxy
    ports:
    - port: 3128
      protocol: TCP

---
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: allow-same-namespace
spec:
  podSelector: {}
  ingress:
  - from:
    - podSelector: {}
  egress:
  - to:
    - podSelector: {}
---
# allow incoming connections from Ingress controller (to make Route and Ingress work)
kind: NetworkPolicy
apiVersion: networking.k8s.io/v1
metadata:
  name: allow-from-openshift-ingress
spec:
  podSelector: {}
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              network.openshift.io/policy-group: ingress
  policyTypes:
    - Ingress

EOF
```

5. Follow the instructions to add the proxy environment variables for an [Operator-based](corporate-proxy.md#operator-deployment) or [Helm-based](corporate-proxy.md#helm-deployment) deployment.

Example with a Custom Resource:

```yaml
apiVersion: rhdh.redhat.com/v1alpha1
kind: Backstage
metadata:
  name: my-rhdh
spec:
  application:
    appConfig:
      configMaps:
        - name: app-config-rhdh
    dynamicPluginsConfigMapName: dynamic-plugins-rhdh
    extraEnvs:
      envs:
        - name: HTTP_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: HTTPS_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: NO_PROXY
          value: 'localhost'
        - name: ROARR_LOG
          # Logs from global-agent (to inspect proxy settings)
          value: 'true'
      secrets:
        - name: secrets-rhdh
# --- TRUNCATED ---
```



# External Resources

The way the proxy settings are supposed to be parsed and handled is unfortunately not codified in any standard, and might vary depending on the library, especially concerning the `NO_PROXY` handling.
See this nice article from GitLab highlighting some of the subtle differences that might cause issues: [We need to talk: Can we standardize NO_PROXY?](https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/).

For reference, the following resources can help understand how the packages we use here handle such settings:
- Undici's proxy agent tests: https://github.com/nodejs/undici/blob/v6.19.8/test/env-http-proxy-agent.js
- global-agent tests:
  - https://github.com/gajus/global-agent/blob/master/test/global-agent/factories/createGlobalProxyAgent.ts
  - and specifically on the `NO_PROXY` handling: https://github.com/gajus/global-agent/blob/master/test/global-agent/utilities/isUrlMatchingNoProxy.ts
