#!/usr/bin/env bash
set -euo pipefail

# Team's memsource upload script
# Usage: ./memsource-upload.sh -v VERSION -s SPRINT_NUMBER [-t TARGET_LANGS] [FILES...]

# Parse arguments
VERSION=""
SPRINT_NUMBER=""
TARGET_LANGS="fr"  # Default to French
FILES=()

while [[ $# -gt 0 ]]; do
  case $1 in
    -v)
      VERSION="$2"
      shift 2
      ;;
    -s)
      SPRINT_NUMBER="$2" 
      shift 2
      ;;
    -t|--target-langs)
      TARGET_LANGS="$2"
      shift 2
      ;;
    *)
      FILES+=("$1")
      shift
      ;;
  esac
done

# Validate required parameters
if [[ -z "$VERSION" || -z "$SPRINT_NUMBER" ]]; then
  echo "Usage: $0 -v VERSION -s SPRINT_NUMBER [-t TARGET_LANGS] [FILES...]"
  echo "Examples:"
  echo "  $0 -v 1.8 -s 3279 file1.json file2.json"
  echo "  $0 -v 1.8 -s 3279 -t 'fr,es,de' file1.json"
  exit 1
fi

# Load configuration (need REPO_ROOT for config file)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/i18n.config.sh"

# Ensure memsource environment is loaded
[[ -f "$HOME/.memsourcerc" ]] && source "$HOME/.memsourcerc"

# TODO: Replace with actual team memsource upload logic
echo "Would upload ${#FILES[@]} files to memsource:"
echo "  Version: $VERSION"
echo "  Sprint: $SPRINT_NUMBER" 
if [[ ${#FILES[@]} -gt 0 ]]; then
  printf '  Files: %s\n' "${FILES[@]}"
else
  echo "  Files: (none provided)"
fi

# Upload with proper error handling
if [[ ${#FILES[@]} -gt 0 ]]; then
  upload_errors=0
  
  for file in "${FILES[@]}"; do
    echo "  → Uploading: $file"
    # Using project ID from i18n.config.sh with target languages
    if memsource job create --project-id "$TMS_PROJECT_ID" --target-langs "$TARGET_LANGS" --filenames "$file"; then
      echo "    ✅ Success: $file"
    else
              echo "    ❌ Failed: $file"
        ((upload_errors++))
     fi
  done
  
  if [[ $upload_errors -gt 0 ]]; then
    echo "❌ Upload failed: $upload_errors file(s) had errors"
    exit 1  # Exit with error so caching logic catches failure
  else
    echo "✅ Upload complete: All files uploaded successfully"
  fi
else
  echo "  → No files to upload"
fi
