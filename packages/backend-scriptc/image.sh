#!/usr/bin/env bash
# PROTOTYPE — build trimmed ScriptC + Node twin Linux images and compare sizes.
# Usage: yarn prototype:scriptc:image
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/out-image"
SCRIPTC_IMAGE="rhdh-backend-scriptc-poc:local"
NODE_IMAGE="rhdh-backend-scriptc-poc-node:local"

mkdir -p "$OUT"
rm -rf "$OUT"/*
echo "PROTOTYPE — wipe me" >"$OUT/README.wipe-me.txt"

if command -v podman >/dev/null 2>&1; then
  CTR=podman
elif command -v docker >/dev/null 2>&1; then
  CTR=docker
else
  echo "Need podman or docker." >&2
  exit 1
fi

echo "== building ScriptC runtime image =="
"$CTR" build -t "$SCRIPTC_IMAGE" -f "$ROOT/Containerfile.poc" "$ROOT"

echo "== building Node twin image =="
"$CTR" build -t "$NODE_IMAGE" -f "$ROOT/Containerfile.poc-node" "$ROOT"

image_bytes() {
  # Virtual size in bytes from the engine (uncompressed layers as reported).
  "$CTR" image inspect -f '{{.Size}}' "$1"
}

human() {
  local b="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B "$b"
  else
    echo "${b}B"
  fi
}

SCRIPTC_BYTES="$(image_bytes "$SCRIPTC_IMAGE")"
NODE_BYTES="$(image_bytes "$NODE_IMAGE")"

echo "== smoke ScriptC image =="
MSYS_NO_PATHCONV=1 "$CTR" run -d --name rhdh-poc-scriptc-smoke -p 17007:7007 "$SCRIPTC_IMAGE" >/dev/null
cleanup() {
  "$CTR" rm -f rhdh-poc-scriptc-smoke rhdh-poc-node-smoke >/dev/null 2>&1 || true
}
trap cleanup EXIT

ok=0
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:17007/healthcheck" >/dev/null; then
    ok=1
    break
  fi
  sleep 0.25
done
if [[ "$ok" != 1 ]]; then
  echo "ScriptC image healthcheck failed" >&2
  "$CTR" logs rhdh-poc-scriptc-smoke || true
  exit 1
fi
curl -sf "http://127.0.0.1:17007/api/poc/info?echo=hi" | tee "$OUT/scriptc-info.json"
echo

echo "== smoke Node twin =="
MSYS_NO_PATHCONV=1 "$CTR" run -d --name rhdh-poc-node-smoke -p 17017:7007 "$NODE_IMAGE" >/dev/null
ok=0
for i in $(seq 1 40); do
  if curl -sf "http://127.0.0.1:17017/healthcheck" >/dev/null; then
    ok=1
    break
  fi
  sleep 0.25
done
if [[ "$ok" != 1 ]]; then
  echo "Node image healthcheck failed" >&2
  "$CTR" logs rhdh-poc-node-smoke || true
  exit 1
fi
curl -sf "http://127.0.0.1:17017/api/poc/info?echo=hi" | tee "$OUT/node-info.json"
echo

RATIO="$(awk "BEGIN {printf \"%.2f\", $NODE_BYTES / $SCRIPTC_BYTES}")"

cat >"$OUT/image-size-report.json" <<EOF
{
  "prototype": true,
  "question": "Trimmed PoC Linux container: ScriptC runtime image vs Node twin (same app/main.ts, not full backend)",
  "images": {
    "scriptc": { "tag": "$SCRIPTC_IMAGE", "bytes": $SCRIPTC_BYTES },
    "node": { "tag": "$NODE_IMAGE", "bytes": $NODE_BYTES }
  },
  "ratioNodeOverScriptc": $RATIO
}
EOF

{
  echo "PROTOTYPE trimmed PoC image size report"
  echo "======================================"
  echo
  echo "ScriptC image:  $(human "$SCRIPTC_BYTES") ($SCRIPTC_BYTES bytes)  [$SCRIPTC_IMAGE]"
  echo "Node twin:      $(human "$NODE_BYTES") ($NODE_BYTES bytes)  [$NODE_IMAGE]"
  echo "node/scriptc:   ${RATIO}x"
  echo
  echo "Run ScriptC PoC:"
  echo "  $CTR run --rm -p 7007:7007 $SCRIPTC_IMAGE"
  echo
  echo "Run Node twin:"
  echo "  $CTR run --rm -p 7007:7007 $NODE_IMAGE"
} | tee "$OUT/image-size-report.txt"
