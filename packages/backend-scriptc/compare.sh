#!/usr/bin/env bash
# PROTOTYPE — host entrypoint. Builds a Linux container and writes size reports to ./out
# Usage (from repo root): yarn prototype:scriptc
# Or: bash packages/backend/prototype-scriptc/compare.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/out"
IMAGE="rhdh-backend-scriptc-compare:local"

mkdir -p "$OUT"
# wipe previous comparison artifacts only
rm -rf "$OUT"/*
# keep a marker so casual readers know this dir is throwaway
echo "PROTOTYPE — wipe me" >"$OUT/README.wipe-me.txt"

echo "== building comparison image =="
# Prefer podman; fall back to docker
if command -v podman >/dev/null 2>&1; then
  CTR=podman
elif command -v docker >/dev/null 2>&1; then
  CTR=docker
else
  echo "Need podman or docker (scriptc servers require Linux; this harness builds in a container)." >&2
  exit 1
fi

"$CTR" build -t "$IMAGE" -f "$ROOT/Containerfile" "$ROOT"

echo "== running size comparison =="
# Git Bash on Windows rewrites /out → a host path; keep the container path literal.
MSYS_NO_PATHCONV=1 "$CTR" run --rm \
  -v "$OUT:/out:Z" \
  "$IMAGE"

echo
echo "Open the shareable decision demo:"
echo "  $ROOT/index.html"
echo
echo "Reports:"
ls -la "$OUT"
echo
if [[ -f "$OUT/size-report.txt" ]]; then
  cat "$OUT/size-report.txt"
fi
