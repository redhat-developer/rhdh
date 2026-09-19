#!/usr/bin/env bash
# PROTOTYPE — runs inside the Linux comparison container.
set -euo pipefail

OUT_DIR="${OUT_DIR:-/out}"
mkdir -p "$OUT_DIR"
REPORT="$OUT_DIR/size-report.json"
TEXT="$OUT_DIR/size-report.txt"

export PATH="/poc/node_modules/.bin:$PATH"
if ! command -v scriptc >/dev/null 2>&1; then
  echo "scriptc CLI not found on PATH after npm install" >&2
  ls -la /poc/node_modules/.bin || true
  exit 1
fi

bytes() {
  # portable byte size
  wc -c <"$1" | tr -d ' '
}

human() {
  local b="$1"
  if command -v numfmt >/dev/null 2>&1; then
    numfmt --to=iec --suffix=B "$b"
  else
    echo "${b}B"
  fi
}

wait_http() {
  local url="$1"
  local i
  for i in $(seq 1 30); do
    if curl -sf "$url" >/dev/null; then
      return 0
    fi
    sleep 0.2
  done
  echo "timed out waiting for $url" >&2
  return 1
}

smoke_kill() {
  local pid="$1"
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

NODE_BIN="$(command -v node)"
NODE_BYTES="$(bytes "$NODE_BIN")"

# --- Fixture A: static HTTP health ---
echo "== coverage: http-health.ts (static) =="
scriptc coverage http-health.ts | tee "$OUT_DIR/coverage-http-health.txt" || true

echo "== clang =="
clang --version | head -2

echo "== build: scriptc static http-health =="
# Prefer C backend for broader clang compatibility; LLVM needs recent clang.
scriptc build http-health.ts --backend c -o "$OUT_DIR/http-health.scriptc"
STATIC_BYTES="$(bytes "$OUT_DIR/http-health.scriptc")"

echo "== build: node transpile http-health =="
npx tsc http-health.ts --outDir "$OUT_DIR/node-http-health" --esModuleInterop --module nodenext --moduleResolution nodenext --target ES2022 --types node
NODE_APP_A="$(bytes "$OUT_DIR/node-http-health/http-health.js")"
NODE_DEPLOY_A=$((NODE_BYTES + NODE_APP_A))

# smoke both
"$OUT_DIR/http-health.scriptc" 17007 &
PID_A=$!
wait_http "http://127.0.0.1:17007/healthcheck"
smoke_kill "$PID_A"

node "$OUT_DIR/node-http-health/http-health.js" 17017 &
PID_NA=$!
wait_http "http://127.0.0.1:17017/healthcheck"
smoke_kill "$PID_NA"

# --- Fixture B: HTTP + zod (needs --dynamic) ---
echo "== coverage: http-with-dep.ts --dynamic =="
scriptc coverage http-with-dep.ts --dynamic | tee "$OUT_DIR/coverage-http-with-dep.txt" || true

echo "== build: scriptc --dynamic http-with-dep =="
scriptc build http-with-dep.ts --dynamic --backend c -o "$OUT_DIR/http-with-dep.scriptc"
DYNAMIC_BYTES="$(bytes "$OUT_DIR/http-with-dep.scriptc")"

echo "== build: node transpile http-with-dep + prod deps =="
npx tsc http-with-dep.ts --outDir "$OUT_DIR/node-http-with-dep" --esModuleInterop --module nodenext --moduleResolution nodenext --target ES2022 --types node
mkdir -p "$OUT_DIR/node-http-with-dep-deploy/node_modules"
cp "$OUT_DIR/node-http-with-dep/http-with-dep.js" "$OUT_DIR/node-http-with-dep-deploy/"
# Use the exact zod version already installed in the image (avoid npm pack latest).
cp -a /poc/node_modules/zod "$OUT_DIR/node-http-with-dep-deploy/node_modules/zod"
NODE_APP_B="$(du -sb "$OUT_DIR/node-http-with-dep-deploy" | awk '{print $1}')"
NODE_DEPLOY_B=$((NODE_BYTES + NODE_APP_B))

"$OUT_DIR/http-with-dep.scriptc" 17008 &
PID_B=$!
wait_http "http://127.0.0.1:17008/healthcheck"
smoke_kill "$PID_B"

(
  cd "$OUT_DIR/node-http-with-dep-deploy"
  node http-with-dep.js 17018
) &
PID_NB=$!
wait_http "http://127.0.0.1:17018/healthcheck"
smoke_kill "$PID_NB"

# --- Report ---
cat >"$REPORT" <<EOF
{
  "prototype": true,
  "question": "How does final deploy size compare between Node and a scriptc binary for representative backend slices?",
  "host": {
    "nodeVersion": "$(node -v)",
    "scriptcVersion": "$(scriptc --version 2>/dev/null || npm ls scriptc --depth=0 2>/dev/null | head -2 | tr '\n' ' ')",
    "clangVersion": "$(clang --version | head -1)"
  },
  "baselines": {
    "nodeBinaryBytes": $NODE_BYTES
  },
  "fixtures": {
    "httpHealth": {
      "mode": "scriptc-static",
      "scriptcBinaryBytes": $STATIC_BYTES,
      "nodeAppBytes": $NODE_APP_A,
      "nodeDeployBytes": $NODE_DEPLOY_A,
      "ratioNodeOverScriptc": $(awk "BEGIN {printf \"%.2f\", $NODE_DEPLOY_A / $STATIC_BYTES}")
    },
    "httpWithDep": {
      "mode": "scriptc-dynamic",
      "scriptcBinaryBytes": $DYNAMIC_BYTES,
      "nodeAppPlusDepsBytes": $NODE_APP_B,
      "nodeDeployBytes": $NODE_DEPLOY_B,
      "ratioNodeOverScriptc": $(awk "BEGIN {printf \"%.2f\", $NODE_DEPLOY_B / $DYNAMIC_BYTES}")
    }
  },
  "rhdhNote": "Full packages/backend is NOT compiled here. Next PoC step is scriptc coverage --dynamic on packages/backend/src/index.ts once blockers are inventoryable; native addons (better-sqlite3, isolated-vm) and dynamic plugin loading are hard stops without redesign."
}
EOF

{
  echo "PROTOTYPE ScriptC vs Node size report"
  echo "====================================="
  echo
  echo "Node binary:              $(human "$NODE_BYTES") ($NODE_BYTES bytes)"
  echo
  echo "Fixture A — http-health (static scriptc)"
  echo "  scriptc binary:         $(human "$STATIC_BYTES") ($STATIC_BYTES bytes)"
  echo "  node app.js only:       $(human "$NODE_APP_A") ($NODE_APP_A bytes)"
  echo "  node deploy (bin+app):  $(human "$NODE_DEPLOY_A") ($NODE_DEPLOY_A bytes)"
  echo "  node/scriptc ratio:     $(awk "BEGIN {printf \"%.2f\", $NODE_DEPLOY_A / $STATIC_BYTES}")x"
  echo
  echo "Fixture B — http-with-dep (scriptc --dynamic + zod)"
  echo "  scriptc binary:         $(human "$DYNAMIC_BYTES") ($DYNAMIC_BYTES bytes)"
  echo "  node app+zod:           $(human "$NODE_APP_B") ($NODE_APP_B bytes)"
  echo "  node deploy (bin+tree): $(human "$NODE_DEPLOY_B") ($NODE_DEPLOY_B bytes)"
  echo "  node/scriptc ratio:     $(awk "BEGIN {printf \"%.2f\", $NODE_DEPLOY_B / $DYNAMIC_BYTES}")x"
  echo
  echo "JSON written to $REPORT"
} | tee "$TEXT"

echo "DONE"
