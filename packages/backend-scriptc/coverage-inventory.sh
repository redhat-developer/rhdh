#!/usr/bin/env bash
# PROTOTYPE — inventory scriptc coverage toward a full backend / dynamic-plugins PoC.
# Usage: yarn prototype:scriptc:coverage
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/../.." && pwd)"
OUT="$ROOT/out-coverage"
IMAGE="rhdh-backend-scriptc-toolchain:local"

mkdir -p "$OUT"
if [[ "${SKIP_COMPLETED:-0}" == "1" ]]; then
  # Keep existing *.coverage.txt so rungs can be resumed.
  rm -f "$OUT"/READINESS.txt "$OUT"/triage.txt 2>/dev/null || true
else
  rm -f "$OUT"/*.coverage.txt "$OUT"/*.coverage.err "$OUT"/READINESS.txt "$OUT"/triage.txt "$OUT"/ladder-summary.tsv 2>/dev/null || true
fi
echo "PROTOTYPE — wipe me" >"$OUT/README.wipe-me.txt"

if command -v podman >/dev/null 2>&1; then
  CTR=podman
elif command -v docker >/dev/null 2>&1; then
  CTR=docker
else
  echo "Need podman or docker." >&2
  exit 1
fi

echo "== building toolchain image =="
"$CTR" build -t "$IMAGE" -f "$ROOT/Containerfile.toolchain" "$ROOT"

echo "== running coverage ladder + full backend index =="
echo "Progress: heartbeat every ${HEARTBEAT_SECS:-5}s; SKIP_COMPLETED=${SKIP_COMPLETED:-0}"
# -t allocates a TTY so heartbeats flush live on Windows/Podman.
MSYS_NO_PATHCONV=1 "$CTR" run --rm -t \
  -e "HEARTBEAT_SECS=${HEARTBEAT_SECS:-5}" \
  -e "SKIP_COMPLETED=${SKIP_COMPLETED:-0}" \
  -v "$REPO:/work:Z" \
  -w /work \
  "$IMAGE" \
  bash /work/packages/backend-scriptc/coverage-inside.sh

echo
echo "Artifacts in $OUT:"
ls -la "$OUT"
echo
if [[ -f "$OUT/READINESS.txt" ]]; then
  cat "$OUT/READINESS.txt"
fi
