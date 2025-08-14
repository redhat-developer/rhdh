# Running the Showcase application behind a corporate proxy

Out of the box, the Showcase application can be run behind a corporate proxy, by setting any of the following environment variables prior to starting the application:

- `HTTP_PROXY`: Proxy to use for HTTP requests.
- `HTTPS_PROXY`: Proxy to use for HTTPS requests.

Additionally, you can set the `NO_PROXY` environment variable to exclude certain domains from proxying. The value is a comma or space-separated list of hostnames that do not require a proxy to get reached, even if one is specified.

## Understanding the `NO_PROXY` exclusion rules

`NO_PROXY` is a comma or space-separated list of hostnames or IP addresses, optionally with port numbers. If the input URL matches any of the entries listed in `NO_PROXY`, then that URL will be fetched by a direct request (i.e., bypassing the proxy settings).

Note that the default value for `NO_PROXY` in the container image is `localhost,127.0.0.1`. If you want to override it, please make sure to also include at least `localhost` or `localhost:7007` in the list; otherwise, the Backend might not work correctly.

Matching follows the rules below:

- `NO_PROXY=*` will bypass the proxy for all requests.
- Space and commas may be used to separate the entries in the `NO_PROXY` list. For example, `NO_PROXY=localhost,example.com`, `NO_PROXY="localhost example.com"`, or `NO_PROXY="localhost, example.com"` would have the same effect.
- If `NO_PROXY` does not contain any entries, then all requests will be sent through the proxy if the `HTTP(S)_PROXY` settings are configured. Otherwise, requests will be fetched directly.
- No DNS lookup is performed to decide if a request should bypass the proxy or not. For example, if DNS is known to resolve `example.com` to `1.2.3.4`, setting `NO_PROXY=1.2.3.4` will not have any effect on requests sent to `example.com`. Only requests explicitly sent to the IP address `1.2.3.4` will bypass the proxy.
- If a port is added after the host name or IP Address, then the input request must match both the host/IP and port in order to bypass the proxy. For example, `NO_PROXY=example.com:1234` would exclude requests to `http(s)://example.com:1234` (so calling them directly), but not requests to other ports like `http(s)://example.com` (which will be sent through the proxy).
- If no port is specified after the host name or IP address, all requests to that host/IP address will bypass the proxy regardless of the port. For example, `NO_PROXY=localhost` would exclude all requests sent to `localhost` (so calling them directly), like `http(s)://localhost:7077` and `http(s)://localhost:8888`.
- IP Address blocks in CIDR notation will not work. So setting `NO_PROXY=10.11.0.0/16` will not have any effect, even if a request is explicitly sent to an IP address in that block.
- Only IPv4 addresses are supported. IPv6 addresses like `::1` will not work.
- Generally, the proxy is only bypassed if the host name is an exact match for an entry in the `NO_PROXY` list. The only exceptions are entries that start with a dot (`.`) or with a wildcard (`*`). In such a case, the proxy is bypassed if the host name ends with the entry. Please note that you should list both the domain and the wildcard domain if you want to exclude a domain and all its subdomains. For example, you would set `NO_PROXY=example.com,.example.com` to bypass the proxy for requests sent to `http(s)://example.com` and `http(s)://subdomain.example.com`.

## Helm deployment

You can set the proxy information in your Helm `values` file, like so:

```yaml
upstream:
  backstage:
    extraEnvVars:
      # Proxy to use for HTTP requests
      - name: HTTP_PROXY
        value: '<my_http_proxy_url>'
      # Proxy to use for HTTPS requests
      - name: HTTPS_PROXY
        value: '<my_https_proxy_url>'
      - name: NO_PROXY
        # List of comma-separated URLs that should be excluded from proxying.
        # Make sure you include 'localhost'.
        # Example: 'localhost,foo.com,baz.com'
        value: '<my_no_proxy_settings>'
```

<details>
<summary>Example</summary>

```yaml
# --- Truncated ---
upstream:
  backstage:
    extraEnvVars:
      - name: HTTP_PROXY
        value: 'http://10.10.10.105:3128'
      - name: HTTPS_PROXY
        value: 'http://10.10.10.106:3128'
      - name: NO_PROXY
        value: 'localhost,example.org'
```

</details>

## Operator deployment

You can set the proxy information in your Custom Resource, like so:

```yaml
spec:
  application:
    extraEnvs:
      envs:
        # Proxy to use for HTTP requests
        - name: HTTP_PROXY
          value: '<my_http_proxy_url>'
        # Proxy to use for HTTPS requests
        - name: HTTPS_PROXY
          value: '<my_https_proxy_url>'
        - name: NO_PROXY
          # List of comma-separated URLs that should be excluded from proxying.
          # Make sure you include 'localhost'.
          # Example: 'localhost,foo.com,baz.com'
          value: '<my_no_proxy_settings>'
```

<details>
<summary>Example</summary>

```yaml
spec:
  # --- Truncated ---
  application:
    extraEnvs:
      envs:
        - name: HTTP_PROXY
          value: 'http://10.10.10.105:3128'
        - name: HTTPS_PROXY
          value: 'http://10.10.10.106:3128'
        - name: NO_PROXY
          value: 'localhost,example.org'
```

</details>

**NOTE**: Instead of specifying the proxy settings in each Custom Resource, you can edit the Operator default configuration once. To do so, look for a `ConfigMap` named `backstage-default-config` in the namespace where the Operator is deployed (typically `backstage-system` or `rhdh-operator`). Then edit the `deployment.yaml` key by adding the `HTTP(S)_PROXY` and `NO_PROXY` environment variables to the containers listed in this Deployment spec.
