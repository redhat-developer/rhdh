# Corporate proxy configuration

Red Hat Developer Hub relies on **Node.js built-in proxy support**, aligned with upstream Backstage. Outbound proxying is **opt-in**: set `NODE_USE_ENV_PROXY=1` together with `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` on workloads that make outbound requests (backend, init containers, and similar). The container image does not enable proxy support by default.

## Canonical documentation

Production Helm, Operator, and adopter configuration are documented elsewhere:

- Upstream: [Running Backstage behind a Corporate Proxy](https://backstage.io/docs/tutorials/corporate-proxy/)
- Red Hat product documentation: [Run RHDH behind a corporate proxy](https://docs.redhat.com/en/documentation/red_hat_developer_hub/2.1/html/configuring_red_hat_developer_hub/assembly-run-rhdh-behind-a-corporate-proxy)

The sections below cover **this repository**: local development and cluster-based testing only.

## Local development with `yarn`

When running this repository locally behind a proxy, set `NODE_USE_ENV_PROXY=1` and the standard proxy variables before starting the backend (for example with `yarn start`):

```shell
export NODE_USE_ENV_PROXY=1
export HTTP_PROXY=http://localhost:3128
export HTTPS_PROXY=http://localhost:3128
export NO_PROXY='localhost,127.0.0.1'
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

## Logging

To debug native `fetch` behavior with proxy settings, set `NODE_DEBUG=fetch`. See the [Node.js debugging documentation](https://nodejs.org/api/cli.html#node_debugmodule).

## Testing

The most challenging part of writing an end-to-end test from the context of a corporate proxy is to set up an environment where an application is forbidden access to the public Internet except through that proxy.

### Locally with `podman-compose` or `docker-compose`

You can leverage the [`rhdh-local`](https://github.com/redhat-developer/rhdh-local) project to test how a given Showcase/Red Hat Developer Hub container image would behave when it is running behind a corporate proxy server. You would need either [`podman-compose`](https://docs.podman.io/en/latest/markdown/podman-compose.1.html) or [Docker Compose](https://docs.docker.com/compose/).

See [Corporate Proxy Setup](https://github.com/redhat-developer/rhdh-local/blob/main/docs/rhdh-local-guide/corporate-proxy-setup-sim.md) in the rhdh-local repository.

### On a cluster

This approach simulates a corporate proxy environment in a Kubernetes/OpenShift namespace with the help of [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) to control ingress and egress traffic for pods within that namespace.

#### Kubernetes

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

5. Configure proxy environment variables on the deployment. Use the Red Hat [configuring guide](https://docs.redhat.com/en/documentation/red_hat_developer_hub/2.1/html/configuring_red_hat_developer_hub/assembly-run-rhdh-behind-a-corporate-proxy) for Helm or Operator procedures.

Example with a Custom Resource (set `NODE_USE_ENV_PROXY=1` with your proxy URLs):

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
        - name: NODE_USE_ENV_PROXY
          value: '1'
        - name: HTTP_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: HTTPS_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: NO_PROXY
          value: 'localhost'
      secrets:
        - name: secrets-rhdh
# --- TRUNCATED ---
```

#### OpenShift

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

5. Configure proxy environment variables on the deployment. Use the Red Hat [configuring guide](https://docs.redhat.com/en/documentation/red_hat_developer_hub/2.1/html/configuring_red_hat_developer_hub/assembly-run-rhdh-behind-a-corporate-proxy) for Helm or Operator procedures.

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
        - name: NODE_USE_ENV_PROXY
          value: '1'
        - name: HTTP_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: HTTPS_PROXY
          value: 'http://squid-service.proxy.svc.cluster.local:3128'
        - name: NO_PROXY
          value: 'localhost'
      secrets:
        - name: secrets-rhdh
# --- TRUNCATED ---
```

## External resources

The way proxy settings are parsed and handled is not fully standardized across libraries, especially for `NO_PROXY`. See [We need to talk: Can we standardize NO_PROXY?](https://about.gitlab.com/blog/2021/01/27/we-need-to-talk-no-proxy/).
