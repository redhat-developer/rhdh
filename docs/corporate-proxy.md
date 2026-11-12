# Corporate proxy configuration

Red Hat Developer Hub uses the same Node.js proxy support as upstream Backstage. Outbound traffic goes through a proxy only when you turn it on: set `NODE_USE_ENV_PROXY=1` along with `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` on the RHDH backend (in your shell before `yarn start`, or on the backend container in a deployment). The shipped image does not enable proxying by default. It sets `NO_PROXY` to `localhost,127.0.0.1` so local loopback calls are not proxied when you do enable it.

## Documentation

These guides explain the variables and how to configure production installs. The Red Hat document includes Helm and Operator steps.

- Node.js: [Enterprise network configuration (proxy)](https://nodejs.org/en/learn/http/enterprise-network-configuration)
- Backstage: [Running Backstage behind a Corporate Proxy](https://backstage.io/docs/tutorials/corporate-proxy/)
- Red Hat: [Run RHDH behind a corporate proxy](https://github.com/redhat-developer/red-hat-developers-documentation-rhdh/blob/main/assemblies/configure_configuring-rhdh/assembly-run-rhdh-behind-a-corporate-proxy.adoc)

What follows is specific to **this repo**: running from source locally and optional ways to test behind a proxy.

## Local development with `yarn`

Behind a proxy, export the variables below, then start the backend:

```shell
export NODE_USE_ENV_PROXY=1
export HTTP_PROXY=http://localhost:3128
export HTTPS_PROXY=http://localhost:3128
export NO_PROXY='localhost,127.0.0.1'
yarn start
```

<!-- markdown-link-check-disable-next-line -->
To run a local Squid proxy for testing:

```shell
podman container run --rm --name squid-container \
  -e TZ=UTC \
  -p 3128:3128 \
  -it registry.redhat.io/rhel9/squid:latest
```

## Logging

For verbose outbound HTTP logging, set `NODE_DEBUG=fetch`. See [Node.js debugging](https://nodejs.org/api/cli.html#node_debugmodule).

## Testing

Put RHDH in an environment where the internet is reachable only through a proxy, then check that catalog and integrations work with the proxy variables set and break or fail without them.

### With Compose

Use [`rhdh-local`](https://github.com/redhat-developer/rhdh-local) with `podman-compose` or Docker Compose. Steps are in [Corporate Proxy Setup](https://github.com/redhat-developer/rhdh-local/blob/main/docs/rhdh-local-guide/corporate-proxy-setup-sim.md).

### On a cluster

You can recreate the same idea on Kubernetes or OpenShift: run Squid (or another HTTP proxy) in one namespace, run RHDH and its database in another, and use [network policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/) so application pods cannot reach the internet except via DNS, the proxy, and other pods in their own namespace. Set `HTTP_PROXY` and `HTTPS_PROXY` to the in-cluster proxy URL, set `NODE_USE_ENV_PROXY=1`, and list hosts that must bypass the proxy in `NO_PROXY`. On OpenShift, allow traffic from the ingress/router if you test through a Route.

Exact YAML depends on your cluster. For production Helm or Operator settings, use the Red Hat document linked above.
