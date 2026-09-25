#!/usr/bin/env bash
# PROTOTYPE — runs inside the toolchain container (repo mounted at /work).
set -euo pipefail

OUT=/work/packages/backend-scriptc/out-coverage
HEARTBEAT_SECS="${HEARTBEAT_SECS:-5}"
# If 1, skip rungs that already have a non-empty .coverage.txt
SKIP_COMPLETED="${SKIP_COMPLETED:-0}"
mkdir -p "$OUT"

relink() {
  local link="$1" target="$2"
  rm -f "$link"
  ln -s "$target" "$link"
  echo "relink $link -> $target"
}

cd /work
mkdir -p node_modules/@internal node_modules/@red-hat-developer-hub
relink node_modules/@internal/plugin-dynamic-plugins-info-backend /work/plugins/dynamic-plugins-info-backend
relink node_modules/@internal/plugin-licensed-users-info-backend /work/plugins/licensed-users-info-backend
relink node_modules/@internal/plugin-scalprum-backend /work/plugins/scalprum-backend
relink node_modules/@red-hat-developer-hub/plugin-utils /work/packages/plugin-utils
relink node_modules/app /work/packages/app
relink node_modules/app-next /work/packages/app-next
relink node_modules/backend /work/packages/backend
relink node_modules/theme-wrapper /work/packages/theme-wrapper

# Avoid process-substitution + wait hangs: write to files, heartbeat polls them.
run_cov() {
  local idx="$1" total="$2" label="$3" file="$4"
  local base out_txt out_err start end code hb_pid
  base="$(echo "$label" | tr '/ ' '__')"
  out_txt="$OUT/${base}.coverage.txt"
  out_err="$OUT/${base}.coverage.err"

  echo
  echo "======== [$idx/$total] coverage: $label ========"
  echo "file: $file"
  echo "note: scriptc has no progress flag; heartbeat every ${HEARTBEAT_SECS}s"
  echo

  start=$(date +%s)
  : >"$out_txt"
  : >"$out_err"

  (
    while true; do
      sleep "$HEARTBEAT_SECS"
      end=$(date +%s)
      out_bytes=$(wc -c <"$out_txt" | tr -d ' ')
      err_bytes=$(wc -c <"$out_err" | tr -d ' ')
      hint=""
      if [[ "$out_bytes" -gt 0 ]]; then
        hint=" | last: $(tail -n 1 "$out_txt" | tr -d '\r' | cut -c1-100)"
      elif [[ "$err_bytes" -gt 0 ]]; then
        hint=" | last err: $(tail -n 1 "$out_err" | tr -d '\r' | cut -c1-100)"
      else
        hint=" | (still typechecking — no scriptc output yet)"
      fi
      echo "[$idx/$total $label] still running… $((end - start))s elapsed (stdout=${out_bytes}B stderr=${err_bytes}B)${hint}"
    done
  ) &
  hb_pid=$!

  set +e
  if command -v stdbuf >/dev/null 2>&1; then
    stdbuf -oL -eL scriptc coverage "$file" --dynamic >"$out_txt" 2>"$out_err"
  else
    scriptc coverage "$file" --dynamic >"$out_txt" 2>"$out_err"
  fi
  code=$?
  set -e

  kill "$hb_pid" 2>/dev/null || true
  wait "$hb_pid" 2>/dev/null || true
  end=$(date +%s)

  # Mirror report to console after completion (avoids tee hang).
  echo
  echo "[$idx/$total $label] finished exit=$code elapsed=$((end - start))s"
  echo "--- report head ---"
  head -n 80 "$out_txt" || true
  if [[ -s "$out_err" ]]; then
    echo "--- stderr head ---"
    head -n 40 "$out_err" || true
  fi
  local lines
  lines=$(wc -l <"$out_txt" | tr -d ' ')
  if [[ "$lines" -gt 80 ]]; then
    echo "... (full report in ${base}.coverage.txt, $lines lines)"
  fi
  printf '%s\t%s\t%s\n' "$label" "$code" "$((end - start))" >>"$OUT/ladder-summary.tsv"
}

# Preserve prior timings when skipping completed rungs.
if [[ "$SKIP_COMPLETED" == "1" && -f "$OUT/ladder-summary.tsv" ]]; then
  cp "$OUT/ladder-summary.tsv" "$OUT/ladder-summary.prev.tsv"
else
  rm -f "$OUT/ladder-summary.prev.tsv"
fi
printf 'label\texit\tseconds\n' >"$OUT/ladder-summary.tsv"

prev_secs() {
  local label="$1"
  if [[ -f "$OUT/ladder-summary.prev.tsv" ]]; then
    awk -F'\t' -v l="$label" '$1==l {print $3; exit}' "$OUT/ladder-summary.prev.tsv"
  fi
}

# Monkey-patch skip path to use preserved timings
# (run_cov reads ladder-summary.tsv for prev — point it at .prev instead)
run_cov_skip_aware() {
  local idx="$1" total="$2" label="$3" file="$4"
  local base out_txt
  base="$(echo "$label" | tr '/ ' '__')"
  out_txt="$OUT/${base}.coverage.txt"
  if [[ "$SKIP_COMPLETED" == "1" && -s "$out_txt" ]] && grep -qE 'builds with --dynamic|fully static|not analyzable|blockers:' "$out_txt"; then
    echo
    echo "======== [$idx/$total] coverage: $label ========"
    echo "skip: existing report at $out_txt"
    printf '%s\t%s\t%s\n' "$label" "skipped" "$(prev_secs "$label" || echo '?')" >>"$OUT/ladder-summary.tsv"
    return 0
  fi
  run_cov "$idx" "$total" "$label" "$file"
}

TOTAL=6
run_cov_skip_aware 1 "$TOTAL" "01-main-trimmed" packages/backend-scriptc/src/main.ts
run_cov_skip_aware 2 "$TOTAL" "02-create-backend-empty" packages/backend-scriptc/src/entries/02-create-backend-empty.ts
run_cov_skip_aware 3 "$TOTAL" "03-create-backend-health" packages/backend-scriptc/src/entries/03-create-backend-health.ts
run_cov_skip_aware 4 "$TOTAL" "04-core-static-plugins" packages/backend-scriptc/src/entries/04-core-static-plugins.ts
run_cov_skip_aware 5 "$TOTAL" "05-with-dynamic-plugins" packages/backend-scriptc/src/entries/05-with-dynamic-plugins.ts
run_cov_skip_aware 6 "$TOTAL" "99-full-backend-index" packages/backend/src/index.ts

echo
echo "======== triage ========"
python3 /work/packages/backend-scriptc/triage-coverage.py "$OUT"
