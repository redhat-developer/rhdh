#!/usr/bin/env bash
set -euo pipefail

# Parse command line arguments
OVERRIDE_RELEASE=""
OVERRIDE_SPRINT=""
OVERRIDE_PROJECT_ID=""
OVERRIDE_TARGET_LANGS=""

usage() {
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -r, --release VERSION       RHDH release version (default: from config)"
  echo "  -s, --sprint NUMBER         Sprint number (default: from config)" 
  echo "  -p, --project-id ID         Phrase TMS project ID (default: from config)"
  echo "  -t, --target-langs LANGS    Target languages (comma-separated, default: fr)"
  echo "  -h, --help                  Show this help"
  echo ""
  echo "Examples:"
  echo "  $0                                    # Use config defaults"
  echo "  $0 -r 1.9 -s 3280                   # Override release and sprint"
  echo "  $0 -p 12345 -t 'fr,es,de'           # Different project and languages"
  echo "  CLEAN_AFTER_UPLOAD=1 $0 -r 2.0      # With environment variable"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -r|--release)
      OVERRIDE_RELEASE="$2"
      shift 2
      ;;
    -s|--sprint)
      OVERRIDE_SPRINT="$2"
      shift 2
      ;;
    -p|--project-id)
      OVERRIDE_PROJECT_ID="$2"
      shift 2
      ;;
    -t|--target-langs)
      OVERRIDE_TARGET_LANGS="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      usage
      exit 1
      ;;
  esac
done

# cd to repo root (so node module resolution works)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

# Load config
# shellcheck source=/dev/null
[[ -f "$SCRIPT_DIR/i18n.config.sh" ]] && source "$SCRIPT_DIR/i18n.config.sh"
# Optional per-dev overrides (ignored by git)
[[ -f "$SCRIPT_DIR/i18n.local.env" ]] && source "$SCRIPT_DIR/i18n.local.env"
# Fallback to user's CLI config if present
[[ -f "$HOME/.memsourcerc" ]] && source "$HOME/.memsourcerc"

# Override config with command line arguments
[[ -n "$OVERRIDE_RELEASE" ]] && RHDH_RELEASE="$OVERRIDE_RELEASE"
[[ -n "$OVERRIDE_SPRINT" ]] && SPRINT_NUMBER="$OVERRIDE_SPRINT"  
[[ -n "$OVERRIDE_PROJECT_ID" ]] && TMS_PROJECT_ID="$OVERRIDE_PROJECT_ID"
[[ -n "$OVERRIDE_TARGET_LANGS" ]] && TARGET_LANGS="$OVERRIDE_TARGET_LANGS"

# Set default target language if not specified
TARGET_LANGS="${TARGET_LANGS:-fr}"

echo "==> i18n Upload Configuration"
echo "    RHDH Release: $RHDH_RELEASE"
echo "    Sprint: $SPRINT_NUMBER"
echo "    Project ID: $TMS_PROJECT_ID" 
echo "    Target Languages: $TARGET_LANGS"

# --- Release/host normalization ----------------------------------------------
: "${RHDH_RELEASE:=1.8}"
# Accept MEMSOURCE_URL or MEMSOURCE_HOST (team rc uses URL)
: "${MEMSOURCE_HOST:=${MEMSOURCE_URL:-https://cloud.memsource.com/web}}"
: "${TMS_PROJECT_ID:?TMS_PROJECT_ID not set in i18n.config.sh or env}"

# --- Staging directories ------------------------------------------------------
# Place staging files inside the rhdh repository for easy developer access
STAGING_DIR="$REPO_ROOT/ui-i18n/$RHDH_RELEASE"
# Generate directly in staging directory (no subdirectory duplication)
GENERATED_DIR="$STAGING_DIR"

CACHE_DIR="$REPO_ROOT/.ui-i18n-cache/$RHDH_RELEASE"
mkdir -p "$CACHE_DIR"

# --- Guards / helpers ---------------------------------------------------------
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing dependency: $1"; exit 1; }; }
need jq
need memsource
need node

# Portable file hash (md5sum on Linux, shasum/md5 on macOS)
hash_file() {
  local f="$1"
  if command -v md5sum >/dev/null 2>&1; then
    md5sum "$f" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$f" | awk '{print $1}'
  elif command -v md5 >/dev/null 2>&1; then
    md5 -q "$f"
  else
    echo "No checksum tool found (md5sum/shasum/md5)"; exit 1
  fi
}

should_upload() {
  local f="$1"
  local rel="${f#$STAGING_DIR/}"
  local sig_file="$CACHE_DIR/${rel//\//__}.sig"
  local sig
  sig="$(hash_file "$f")"
  if [[ -f "$sig_file" && "$(cat "$sig_file")" == "$sig" ]]; then
    return 1   # unchanged → skip
  else
    return 0   # changed → upload (cache signature written after successful upload)
  fi
}

# Cache file signature after successful upload
mark_uploaded() {
  local f="$1"
  local rel="${f#$STAGING_DIR/}"
  local sig_file="$CACHE_DIR/${rel//\//__}.sig"
  local sig
  sig="$(hash_file "$f")"
  printf '%s' "$sig" > "$sig_file"
}

fail_if_missing_auth() {
  # username+password rc generates MEMSOURCE_TOKEN
  if [[ -z "${MEMSOURCE_TOKEN:-}" ]]; then
    echo "MEMSOURCE_TOKEN not set. Did you run:  source ~/.memsourcerc  ?"
    echo "Should export MEMSOURCE_USERNAME/PASSWORD and generate a token."
    exit 1
  fi
  if [[ -z "${MEMSOURCE_USERNAME:-}" ]]; then
    echo "Warning: MEMSOURCE_USERNAME not set; continuing because MEMSOURCE_TOKEN is present."
  fi
  if [[ "${TMS_PROJECT_ID}" == "__FILL_ME_IN__" ]]; then
    echo "TMS_PROJECT_ID is not set in i18n.config.sh"; exit 1
  fi
}

# --- Step 0: clean staging ----------------------------------------------------
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR" "$GENERATED_DIR"

# --- Step 1: generate en.json from TypeScript refs ----------------------------
# This scans for files named 'ref.ts' (or 'i18n.ts') that export a messages object.
generate_from_ts() {
  local repo_root="$1"
  local label="$2"

  [[ -d "$repo_root" ]] || return 0

  while IFS= read -r -d '' tsfile; do
    # Derive a stable output name from repo + relative path
    local rel="${tsfile#$repo_root/}"
    local base="${label}__${rel//\//__}"          # replace slashes with __
    local out="$GENERATED_DIR/${base%.ts}-en.json"

    echo "• Generating JSON from TS: $tsfile"
    if ! node "$SCRIPT_DIR/extract-ts-messages.mjs" --ts "$tsfile" --out "$out"; then
      echo "  (skip) Could not extract from $tsfile"
    fi
done < <(find "$repo_root" \
           -type d \( -name node_modules -o -name dist -o -name lib -o -name build -o -name coverage -o -name .git \) -prune -o \
           -type f \( -name "ref.ts" -o -name "i18n.ts" \) -print0)
}

echo "==> Generating JSON from TS refs"
echo "Scanning roots:"
echo "  RHDH_DIR=$RHDH_DIR"
echo "  COMMUNITY_PLUGINS_DIR=$COMMUNITY_PLUGINS_DIR"
echo "Note: rhdh-plugins translations are handled by scripts in that repository"
generate_from_ts "$RHDH_DIR" "rhdh"
generate_from_ts "$COMMUNITY_PLUGINS_DIR" "community-plugins"

# --- Step 2: collect existing *-en.json from repos ----------------------------
copy_jsons () {
  local repo_root="$1"
  local label="$2"
  [[ -d "$repo_root" ]] || return 0
  while IFS= read -r -d '' f; do
    local rel="${f#$repo_root/}"
    local out="$STAGING_DIR/${label}__${rel//\//__}"
    cp -f "$f" "$out"
  done < <(find "$repo_root" \
             -type d \( -name node_modules -o -name dist -o -name lib -o -name build -o -name coverage -o -name .git -o -name ui-i18n \) -prune -o \
             -type f \( \
               -path "*/translations/*-en.json" -o \
               -path "*/i18n/*-en.json" -o \
               -path "*/locales/*-en.json" -o \
               -name "*-en.json" \
             \) -print0)
}

echo "==> Collecting existing English catalogs"
copy_jsons "$RHDH_DIR" "rhdh"
copy_jsons "$COMMUNITY_PLUGINS_DIR" "community-plugins"

# --- Step 3: validate JSON ----------------------------------------------------
echo "==> Validating JSON"
ok=1
while IFS= read -r -d '' f; do
  if ! jq -e . > /dev/null 2>&1 <"$f"; then
    echo "✖ Invalid JSON: $f"
    ok=0
  fi
done < <(find "$STAGING_DIR" -maxdepth 1 -type f -name '*.json' -print0)
[[ $ok -eq 1 ]] || { echo "Fix invalid JSON before uploading."; exit 1; }

# --- Step 4: upload once to TMS ----------------------------------------------
fail_if_missing_auth

echo "==> Uploading to TMS project $TMS_PROJECT_ID (host: $MEMSOURCE_HOST)"
count="$(find "$STAGING_DIR" -maxdepth 1 -type f -name '*-en.json' | wc -l | tr -d ' ')"
echo "   Files to upload: $count"
if [[ "$count" -eq 0 ]]; then
  echo "No files found to upload. Exiting."
  exit 0
fi

# Collect files that need uploading and upload in batch
uploaded=0; skipped=0
files_to_upload=()

while IFS= read -r -d '' f; do
  if should_upload "$f"; then
    echo "  → will upload $f"
    files_to_upload+=("$f")
    ((uploaded++))
  else
    echo "  → skip (unchanged) $f"
    ((skipped++))
  fi
done < <(find "$STAGING_DIR" -maxdepth 1 -type f -name '*-en.json' -print0)

# Upload files individually and cache only after successful upload
if [[ ${#files_to_upload[@]} -gt 0 ]]; then
  echo "==> Uploading ${#files_to_upload[@]} files to memsource..."
  upload_success=0
  upload_failed=0
  
  for file in "${files_to_upload[@]}"; do
    echo "  → Uploading: $(basename "$file")"
    if bash "$SCRIPT_DIR/memsource-upload.sh" -v "$RHDH_RELEASE" -s "${SPRINT_NUMBER}" -t "$TARGET_LANGS" "$file"; then
      echo "    ✅ Upload successful"
      mark_uploaded "$file"  # Only cache after successful upload
      ((upload_success++))
    else
      echo "    ❌ Upload failed - will retry next run"
      ((upload_failed++))
    fi
  done
  
  echo "Upload results: ${upload_success} successful, ${upload_failed} failed"
fi
echo "Upload summary: uploaded=$uploaded, skipped=$skipped"
echo "✓ Upload complete. Staged files are in: $STAGING_DIR"

# Optional cleanup after successful upload
# Example: CLEAN_AFTER_UPLOAD=1 scripts/i18n-scripts/collect-and-upload.sh
if [[ "${CLEAN_AFTER_UPLOAD:-0}" == "1" ]]; then
  echo "==> Cleaning up staging directory"
  rm -rf "$STAGING_DIR"
  echo "✓ Cleaned up: $STAGING_DIR"
else
  echo "💡 To clean up staging files after upload, run:"
  echo "   CLEAN_AFTER_UPLOAD=1 $0"
fi
