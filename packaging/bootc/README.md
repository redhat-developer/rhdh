# RHDH bootc + Quadlet (image mode)

## Build

1. Log in to the Red Hat registry (creates `~/.config/containers/auth.json`):

   ```bash
   podman login registry.redhat.io
   ```

2. From **this directory**:

   ```bash
   ./build.sh
   ```

   If you have no `auth.json` yet, step 1 is required — the script looks for
   `~/.config/containers/auth.json`, `$XDG_RUNTIME_DIR/containers/auth.json`, or
   `~/.docker/config.json`.

Or copy credentials by hand:

```bash
cp ~/.config/containers/auth.json ./auth.json
podman build -f Containerfile.bootc -t rhdh-bootc:latest .
```

`auth.json` is gitignored. Refresh login before each build if pulls fail with **unauthorized**:

`podman login registry.redhat.io`

Credentials are copied to both `/etc/containers/auth.json` and `/root/.config/containers/auth.json` so Quadlet (root podman) can pull images.

## Contents

- `configs/` — RHDH app config, catalog, dynamic plugins
- `quadlet/` — `rhdh.container`, `postgres.container`, network, env
- `scripts/` — plugin prep / startup (same as Ansible image_mode)

RHDH image tag is set in `quadlet/rhdh.container` (default `1.8`).

### Ansible / RHAAP plugins (`local-plugins`)

The override may list `.tgz` plugins under `local-plugins/`. That directory is empty by default (tarballs are often supplied separately). **Disabled plugins** in `dynamic-plugins.override.yaml` keep stock RHDH starting without those files. To use the full Ansible self-service flow: drop the four `ansible-*.tgz` files into `local-plugins/`, set those entries to `disabled: false`, restore the `/self-service` line in `health-check.sh` in `Containerfile.bootc`, then rebuild.

### Test with `podman run` (privileged)

Quadlet uses **default** Podman storage (not `/usr/lib/bootc/storage`), so Postgres/RHDH
can pull on first start inside the guest. First start can take several minutes.

```bash
podman rm -f rhdh-bootc-test 2>/dev/null
podman run -d --name rhdh-bootc-test --privileged -p 7007:7007 -p 5432:5432 localhost/rhdh-bootc:latest
# wait, then:
podman exec rhdh-bootc-test systemctl status postgres.service rhdh.service --no-pager
podman exec rhdh-bootc-test podman ps -a
```

### Open RHDH in the browser (`localhost` vs `127.0.0.1`)

After services are healthy, use:

**`http://127.0.0.1:7007/`**

If **`http://localhost:7007/`** fails with errors like **ERR_SOCKET_NOT_CONNECTED** (or “site can’t be reached”) while **`127.0.0.1`** works:

- **`localhost`** resolves to both IPv4 (`127.0.0.1`) and IPv6 (`::1`). Many browsers try **IPv6 first**.
- RHDH and/or Podman’s published port are typically only reachable over **IPv4** here, so nothing accepts **`::1:7007`**.
- **`127.0.0.1`** forces IPv4 and hits the forwarded port correctly.

Quick check from the host: `curl -v http://127.0.0.1:7007/`

## VM defaults (from Containerfile)

- `admin` / `admin123`, `root` / `root123` — change for anything real.
