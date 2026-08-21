#!/usr/bin/env bash
# PROTOTYPE — compare README-style dims for trimmed PoC: size, startup, RSS, request latency.
# Usage: yarn prototype:scriptc:bench
# Optional: SKIP_BUILD=1 yarn prototype:scriptc:bench
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="$ROOT/out-bench"
SCRIPTC_IMAGE="rhdh-backend-scriptc-poc:local"
NODE_IMAGE="rhdh-backend-scriptc-poc-node:local"
WARMUP_REQUESTS="${WARMUP_REQUESTS:-10}"
LATENCY_REQUESTS="${LATENCY_REQUESTS:-50}"

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

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  echo "== building images =="
  "$CTR" build -t "$SCRIPTC_IMAGE" -f "$ROOT/Containerfile.poc" "$ROOT"
  "$CTR" build -t "$NODE_IMAGE" -f "$ROOT/Containerfile.poc-node" "$ROOT"
fi

image_bytes() { "$CTR" image inspect -f '{{.Size}}' "$1"; }
human_bytes() {
  local b="$1"
  if command -v numfmt >/dev/null 2>&1; then numfmt --to=iec --suffix=B "$b"; else echo "${b}B"; fi
}
human_ms() { awk -v s="$1" 'BEGIN { printf "%.1f ms", s * 1000 }'; }
human_mb() { awk -v b="$1" 'BEGIN { printf "%.1f MB", b / (1024*1024) }'; }

# Parse podman/docker stats memory like "12.3MiB" / "1.2GiB" / "800KiB" → bytes
mem_to_bytes() {
  local raw
  raw="$(echo "$1" | tr -d ' ')"
  python - "$raw" <<'PY'
import re, sys
v = sys.argv[1]
m = re.match(r"^([0-9.]+)([KMGT]i?B)$", v)
if not m:
    print(0); raise SystemExit
n = float(m.group(1)); u = m.group(2)
mult = {"B":1,"KiB":1024,"KB":1000,"MiB":1024**2,"MB":1000**2,"GiB":1024**3,"GB":1000**3}
print(int(n * mult.get(u, 0)))
PY
}

now_s() {
  python - <<'PY'
import time; print(f"{time.time():.6f}")
PY
}

wait_http() {
  local url="$1" deadline_s="${2:-20}"
  local start end
  start="$(now_s)"
  while true; do
    if curl -sf "$url" >/dev/null 2>&1; then
      end="$(now_s)"
      awk -v a="$start" -v b="$end" 'BEGIN { printf "%.6f", b - a }'
      return 0
    fi
    end="$(now_s)"
    awk -v a="$start" -v b="$end" -v d="$deadline_s" 'BEGIN { exit (b - a >= d) ? 0 : 1 }' && {
      echo "timeout waiting for $url" >&2
      return 1
    }
    sleep 0.02
  done
}

avg_latency_s() {
  local url="$1" n="$2"
  local i total=0 t
  for i in $(seq 1 "$n"); do
    t="$(curl -sf -o /dev/null -w '%{time_total}' "$url")"
    total="$(awk -v a="$total" -v b="$t" 'BEGIN { printf "%.8f", a + b }')"
  done
  awk -v a="$total" -v n="$n" 'BEGIN { printf "%.8f", a / n }'
}

# Process RSS inside the container (ENTRYPOINT is PID 1 in both images).
container_rss_bytes() {
  local name="$1"
  "$CTR" exec "$name" sh -c 'awk "/VmRSS:/ { print \$2 * 1024; exit }" /proc/1/status'
}

# On-disk binary / deploy payload inside the image.
container_payload_bytes() {
  local name="$1" kind="$2"
  if [[ "$kind" == "scriptc" ]]; then
    "$CTR" exec "$name" sh -c 'wc -c < /usr/local/bin/rhdh-poc | tr -d " "'
  else
    "$CTR" exec "$name" sh -c 'du -sb /app | awk "{print \$1}"'
  fi
}

bench_one() {
  local kind="$1" image="$2" name="$3" host_port="$4"
  local url="http://127.0.0.1:${host_port}/healthcheck"
  local info_url="http://127.0.0.1:${host_port}/api/poc/info?echo=bench"

  "$CTR" rm -f "$name" >/dev/null 2>&1 || true
  local t0 t_start_s
  t0="$(now_s)"
  MSYS_NO_PATHCONV=1 "$CTR" run -d --name "$name" -p "${host_port}:7007" "$image" >/dev/null
  t_start_s="$(wait_http "$url" 30)" || {
    echo "$kind failed to become healthy" >&2
    "$CTR" logs "$name" || true
    return 1
  }

  # Warmup then steady-state samples
  local i
  for i in $(seq 1 "$WARMUP_REQUESTS"); do curl -sf "$url" >/dev/null; done
  sleep 0.5

  local rss_bytes payload_bytes cgroup_mem latency_s
  rss_bytes="$(container_rss_bytes "$name")"
  payload_bytes="$(container_payload_bytes "$name" "$kind")"
  # cgroup memory from engine stats (includes more than RSS)
  local mem_raw
  mem_raw="$("$CTR" stats --no-stream --format '{{.MemUsage}}' "$name" | awk '{print $1}')"
  cgroup_mem="$(mem_to_bytes "$mem_raw")"
  latency_s="$(avg_latency_s "$url" "$LATENCY_REQUESTS")"
  curl -sf "$info_url" >"$OUT/${kind}-info.json"

  local image_b
  image_b="$(image_bytes "$image")"

  # Export via nameref-like globals
  eval "${kind}_image_bytes=$image_b"
  eval "${kind}_payload_bytes=$payload_bytes"
  eval "${kind}_startup_s=$t_start_s"
  eval "${kind}_rss_bytes=$rss_bytes"
  eval "${kind}_cgroup_bytes=$cgroup_mem"
  eval "${kind}_latency_s=$latency_s"
}

cleanup() {
  "$CTR" rm -f rhdh-poc-scriptc-bench rhdh-poc-node-bench >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== bench ScriptC =="
bench_one scriptc "$SCRIPTC_IMAGE" rhdh-poc-scriptc-bench 17007
"$CTR" rm -f rhdh-poc-scriptc-bench >/dev/null 2>&1 || true

echo "== bench Node twin =="
bench_one node "$NODE_IMAGE" rhdh-poc-node-bench 17017
"$CTR" rm -f rhdh-poc-node-bench >/dev/null 2>&1 || true

ratio() { awk -v a="$1" -v b="$2" 'BEGIN { if (b+0==0) print "n/a"; else printf "%.2f", a/b }'; }

cat >"$OUT/bench-report.json" <<EOF
{
  "prototype": true,
  "question": "README-style compare for trimmed PoC (not full backend): image/binary size, startup, RSS, request latency",
  "readmeDimensions": ["startup", "binary/image size", "memory (RSS)", "runtime (HTTP latency proxy)"],
  "notes": [
    "startup = container start → first successful /healthcheck (includes container overhead)",
    "rss = VmRSS of the app process inside the container",
    "cgroupMem = podman/docker stats MemUsage (broader than RSS)",
    "latency = average curl time_total over ${LATENCY_REQUESTS} /healthcheck requests after warmup",
    "runtime CPU microbenchmarks from the scriptc README are not reproduced here"
  ],
  "scriptc": {
    "imageTag": "$SCRIPTC_IMAGE",
    "imageBytes": $scriptc_image_bytes,
    "payloadBytes": $scriptc_payload_bytes,
    "startupSeconds": $scriptc_startup_s,
    "rssBytes": $scriptc_rss_bytes,
    "cgroupMemBytes": $scriptc_cgroup_bytes,
    "avgHealthLatencySeconds": $scriptc_latency_s
  },
  "node": {
    "imageTag": "$NODE_IMAGE",
    "imageBytes": $node_image_bytes,
    "payloadBytes": $node_payload_bytes,
    "startupSeconds": $node_startup_s,
    "rssBytes": $node_rss_bytes,
    "cgroupMemBytes": $node_cgroup_bytes,
    "avgHealthLatencySeconds": $node_latency_s
  },
  "ratiosNodeOverScriptc": {
    "image": $(ratio "$node_image_bytes" "$scriptc_image_bytes"),
    "payload": $(ratio "$node_payload_bytes" "$scriptc_payload_bytes"),
    "startup": $(ratio "$node_startup_s" "$scriptc_startup_s"),
    "rss": $(ratio "$node_rss_bytes" "$scriptc_rss_bytes"),
    "cgroupMem": $(ratio "$node_cgroup_bytes" "$scriptc_cgroup_bytes"),
    "latency": $(ratio "$node_latency_s" "$scriptc_latency_s")
  }
}
EOF

{
  echo "PROTOTYPE trimmed PoC benchmark (scriptc README dims)"
  echo "===================================================="
  echo
  printf "%-18s %14s %14s %10s\n" "metric" "scriptc" "node" "node/sc"
  printf "%-18s %14s %14s %10s\n" "------------------" "--------------" "--------------" "----------"
  printf "%-18s %14s %14s %10s\n" "image size" "$(human_bytes "$scriptc_image_bytes")" "$(human_bytes "$node_image_bytes")" "$(ratio "$node_image_bytes" "$scriptc_image_bytes")x"
  printf "%-18s %14s %14s %10s\n" "payload on disk" "$(human_bytes "$scriptc_payload_bytes")" "$(human_bytes "$node_payload_bytes")" "$(ratio "$node_payload_bytes" "$scriptc_payload_bytes")x"
  printf "%-18s %14s %14s %10s\n" "startup" "$(human_ms "$scriptc_startup_s")" "$(human_ms "$node_startup_s")" "$(ratio "$node_startup_s" "$scriptc_startup_s")x"
  printf "%-18s %14s %14s %10s\n" "RSS (VmRSS)" "$(human_mb "$scriptc_rss_bytes")" "$(human_mb "$node_rss_bytes")" "$(ratio "$node_rss_bytes" "$scriptc_rss_bytes")x"
  printf "%-18s %14s %14s %10s\n" "cgroup mem" "$(human_mb "$scriptc_cgroup_bytes")" "$(human_mb "$node_cgroup_bytes")" "$(ratio "$node_cgroup_bytes" "$scriptc_cgroup_bytes")x"
  printf "%-18s %14s %14s %10s\n" "avg /healthcheck" "$(human_ms "$scriptc_latency_s")" "$(human_ms "$node_latency_s")" "$(ratio "$node_latency_s" "$scriptc_latency_s")x"
  echo
  echo "README maps roughly to: startup, binary/image size, memory (RSS), runtime (latency proxy)."
  echo "JSON: $OUT/bench-report.json"
} | tee "$OUT/bench-report.txt"
