#!/usr/bin/env bash
# Build from packaging/bootc. Needs RHEL-subscribed host for dnf in base image.
set -e
cd "$(dirname "$0")"

if [[ -f auth.json ]]; then
  echo "Using ./auth.json"
else
  for f in \
    "${CONTAINERS_AUTHFILE:-}" \
    "${HOME}/.config/containers/auth.json" \
    "${XDG_RUNTIME_DIR}/containers/auth.json" \
    "${HOME}/.docker/config.json"
  do
    [[ -n "$f" && -f "$f" ]] || continue
    cp "$f" auth.json
    echo "Copied auth from: $f"
    break
  done
fi

if [[ ! -f auth.json ]]; then
  echo "No registry credentials found."
  echo "Run once:"
  echo "  podman login registry.redhat.io"
  echo "Then either re-run ./build.sh or copy manually:"
  echo "  cp \"\${HOME}/.config/containers/auth.json\" ./auth.json"
  exit 1
fi

exec podman build -f Containerfile.bootc -t rhdh-bootc:latest .
