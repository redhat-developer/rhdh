#!/usr/bin/env bash
#
# Copyright Red Hat, Inc.
# Licensed under the Apache License, Version 2.0 (the "License");
#
# Shell tests for install-dynamic-plugins (bash implementation).
# Requires: bash, curl, jq, openssl, npm, node, tar, sha256sum, mikefarah yq v4+ (or network to download yq).
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

ensure_go_yq() {
  if command -v yq >/dev/null 2>&1 && yq --version 2>&1 | grep -qi 'mikefarah'; then
    export YQ=yq
    return
  fi
  local yqbin="${YQ_CACHE:-/tmp}/yq-mikefarah"
  mkdir -p "$(dirname "$yqbin")"
  if [[ ! -x "$yqbin" ]]; then
    echo "Downloading mikefarah yq v4.44.3..."
    curl -sL -o "$yqbin" "https://github.com/mikefarah/yq/releases/download/v4.44.3/yq_linux_amd64"
    chmod +x "$yqbin"
  fi
  export YQ="$yqbin"
}

test_npm_parse() {
  local out exp
  out="$(node "${SCRIPT_DIR}/npm-parse-plugin-key.cjs" '@backstage/plugin-catalog@1.0.0')"
  [[ "$out" == '@backstage/plugin-catalog' ]] || fail "npm parse expected @backstage/plugin-catalog got $out"
  pass "npm-parse-plugin-key @backstage strip version"
  out="$(node "${SCRIPT_DIR}/npm-parse-plugin-key.cjs" './local')"
  [[ "$out" == './local' ]] || fail "local path"
  pass "npm-parse local path"
}

test_oci_ref() {
  node "${SCRIPT_DIR}/oci-ref.cjs" parse 'oci://quay.io/user/plugin:v1.0' | jq -e '.registry=="quay.io" and .repository=="user/plugin"' >/dev/null
  pass "oci-ref parse host/path:tag"
}

test_empty_yaml() {
  local w
  w="$(mktemp -d)"
  mkdir -p "$w/out"
  printf 'plugins: []\n' >"$w/dynamic-plugins.yaml"
  ( cd "$w" && YQ="$YQ" bash "${SCRIPT_DIR}/install-dynamic-plugins.sh" "$w/out" )
  [[ -f "$w/out/app-config.dynamic-plugins.yaml" ]] || fail "missing app-config"
  pass "empty plugins produces app-config"
  rm -rf "$w"
}

# Expected plugin-config hash for semver@7.0.0 with this integrity (matches former Python json.dumps(sort_keys=True) input).
EXPECTED_SEMVER_CONFIG_HASH='9a1c28348ec09ef4d6d989ee83ac5bbf08e5ba16709fcc55516ca040186377f8'

test_semver_install() {
  local w h
  w="$(mktemp -d)"
  mkdir -p "$w/out"
  cat >"$w/dynamic-plugins.yaml" <<'YAML'
plugins:
  - package: semver@7.0.0
    integrity: sha512-+GB6zVA9LWh6zovYQLALHwv5rb2PHGlJi3lfiqIHxR0uuwCgefcOJc59v9fv1w8GbStwxuuqqAjI9NMAOOgq1A==
YAML
  ( cd "$w" && YQ="$YQ" bash "${SCRIPT_DIR}/install-dynamic-plugins.sh" "$w/out" ) >/dev/null 2>&1
  h="$(cat "$w/out/semver-7.0.0/dynamic-plugin-config.hash")"
  [[ "$h" == "$EXPECTED_SEMVER_CONFIG_HASH" ]] || fail "unexpected plugin hash: $h"
  [[ -f "$w/out/semver-7.0.0/package.json" ]] || fail "missing extracted package"
  pass "semver@7.0.0 install and plugin hash"
  rm -rf "$w"
}

main() {
  need_cmd curl jq openssl npm node tar sha256sum flock
  ensure_go_yq
  "$YQ" --version | head -1

  test_npm_parse
  test_oci_ref
  test_empty_yaml
  test_semver_install

  echo ""
  echo "All tests passed."
}

need_cmd() {
  local m
  for m in "$@"; do
    command -v "$m" >/dev/null 2>&1 || fail "missing command: $m"
  done
}

main "$@"
