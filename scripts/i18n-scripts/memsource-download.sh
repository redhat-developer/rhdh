#!/usr/bin/env bash
set -euo pipefail

# Team's memsource download script
# Usage: ./memsource-download.sh [-p PROJECT_ID] [-l LANGUAGES] [-s STATUS] [-o OUTPUT_DIR] [JOB_IDS...]

# Parse arguments
PROJECT_ID=""
LANGUAGES=""
JOB_STATUS="COMPLETED"
OUTPUT_DIR=""
DRY_RUN=false
JOB_IDS=()

show_usage() {
  echo "Usage: $0 [-p PROJECT_ID] [-l LANGUAGES] [-s STATUS] [-o OUTPUT_DIR] [JOB_IDS...]"
  echo ""
  echo "Options:"
  echo "  -p PROJECT_ID    Memsource project ID (default: from config)"
  echo "  -l LANGUAGES     Target languages, comma-separated (default: from config)"
  echo "  -s STATUS        Job status filter: COMPLETED, NEW, etc. (default: COMPLETED)"
  echo "  -o OUTPUT_DIR    Output directory (default: from config)"
  echo "  --dry-run        Show what would be downloaded without downloading"
  echo "  -h               Show this help"
  echo ""
  echo "Examples:"
  echo "  $0                                    # Download all completed jobs"
  echo "  $0 -l fr,es                          # Download French and Spanish jobs"
  echo "  $0 WPHjtV9f8c9d8ls1DOyl50             # Download specific job ID"
  echo "  $0 -s NEW                            # Download jobs with NEW status"
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--project-id)
      PROJECT_ID="$2"
      shift 2
      ;;
    -l|--languages)
      LANGUAGES="$2"
      shift 2
      ;;
    -s|--status)
      JOB_STATUS="$2"
      shift 2
      ;;
    -o|--output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      show_usage
      exit 0
      ;;
    *)
      JOB_IDS+=("$1")
      shift
      ;;
  esac
done

# Load configuration
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
source "$SCRIPT_DIR/i18n.config.sh"

# Use config defaults if not provided
PROJECT_ID="${PROJECT_ID:-$TMS_PROJECT_ID}"
LANGUAGES="${LANGUAGES:-$DOWNLOAD_LANGS}"
OUTPUT_DIR="${OUTPUT_DIR:-$DOWNLOAD_DIR}"

# Validate required parameters
if [[ -z "$PROJECT_ID" ]]; then
  echo "❌ Error: PROJECT_ID is required (set via -p or config file)"
  show_usage
  exit 1
fi

# Ensure memsource environment is loaded
[[ -f "$HOME/.memsourcerc" ]] && source "$HOME/.memsourcerc"

# Create output directory
mkdir -p "$OUTPUT_DIR"

echo "==> Memsource Download Configuration"
echo "  Project ID: $PROJECT_ID"
echo "  Languages: $LANGUAGES"
echo "  Job Status Filter: $JOB_STATUS"
echo "  Output Directory: $OUTPUT_DIR"

# Cache directory for tracking downloaded jobs (organized by release like upload cache)
CACHE_DIR="${REPO_ROOT}/.ui-i18n-download-cache/$RHDH_RELEASE"

# Function to check if job was already downloaded
is_job_downloaded() {
  local job_id="$1"
  [[ -f "$CACHE_DIR/$job_id" ]]
}

# Function to mark job as downloaded
mark_job_downloaded() {
  local job_id="$1"
  local job_info="$2"
  mkdir -p "$CACHE_DIR"
  echo "$job_info" > "$CACHE_DIR/$job_id"
}

# Function to download a single job
download_job() {
  local job_id="$1"
  local output_dir="$2"
  
  if [[ "$DRY_RUN" == true ]]; then
    echo "  → [DRY RUN] Would download job: $job_id"
    return 0
  else
    echo "  → Downloading job: $job_id"
    
    # Download translated file using the working CLI syntax
    if memsource job download --project-id "$PROJECT_ID" --job-id "$job_id"; then
      echo "    ✅ Downloaded: $job_id"
      return 0
    else
      echo "    ❌ Failed to download: $job_id"
      return 1
    fi
  fi
}

# Main download logic
download_errors=0

if [[ ${#JOB_IDS[@]} -gt 0 ]]; then
  # Download specific job IDs provided as arguments
  echo "==> Downloading ${#JOB_IDS[@]} specific job(s)..."
  
  for job_id in "${JOB_IDS[@]}"; do
    # Get job details 
    echo "  → Getting details for job: $job_id"
    job_info=$(memsource job list --project-id "$PROJECT_ID" --format json | jq -r ".[] | select(.uid == \"$job_id\")")
    
    if [[ -z "$job_info" ]]; then
      echo "    ❌ Job not found: $job_id"
      ((download_errors++))
      continue
    fi
    
    job_lang=$(echo "$job_info" | jq -r '.target_lang')
    job_status=$(echo "$job_info" | jq -r '.status')
    job_filename=$(echo "$job_info" | jq -r '.filename')
    
    echo "    Job $job_id: status=$job_status, language=$job_lang, file=$job_filename"
    
    if [[ "$job_status" != "$JOB_STATUS" ]]; then
      echo "    ⚠️  Skipping job $job_id (status: $job_status, expected: $JOB_STATUS)"
      continue
    fi
    
    # Check if already downloaded
    if is_job_downloaded "$job_id"; then
      echo "    ⚠️  Already downloaded: $job_id (cached)"
      continue
    fi
    
    if download_job "$job_id" "$OUTPUT_DIR"; then
      # Mark as downloaded only after success (but not in dry-run mode)
      if [[ "$DRY_RUN" == false ]]; then
        mark_job_downloaded "$job_id" "$job_info"
      fi
    else
      ((download_errors++))
    fi
  done
  
else
  # Download latest version of each file matching criteria
  echo "==> Discovering jobs and selecting latest versions..."
  
  # Get list of all jobs in the project
  job_list=$(memsource job list --project-id "$PROJECT_ID" --format json)
  
  # Filter by languages and status, then group by filename to get latest
  IFS=',' read -ra LANG_ARRAY <<< "$LANGUAGES"
  
  latest_jobs=()
  
  for lang in "${LANG_ARRAY[@]}"; do
    lang=$(echo "$lang" | xargs)  # Trim whitespace
    
    # Get jobs for this language with the specified status
    filtered_jobs=$(echo "$job_list" | jq -r ".[] | select(.target_lang == \"$lang\" and .status == \"$JOB_STATUS\")")
    
    # Group by filename and select the latest (most recent date_created) for each file
    latest_for_files=$(echo "$filtered_jobs" | jq -s '
      group_by(.filename) | 
      map(sort_by(.date_created) | last) | 
      .[] | .uid'
    )
    
    while IFS= read -r job_id; do
      if [[ -n "$job_id" ]]; then
        # Remove quotes that jq adds
        job_id=$(echo "$job_id" | tr -d '"')
        latest_jobs+=("$job_id")
      fi
    done <<< "$latest_for_files"
  done
  
  echo "  → Found ${#latest_jobs[@]} latest job(s) for unique filenames"
  
  # Filter out already downloaded jobs
  new_jobs=()
  for job_id in "${latest_jobs[@]}"; do
    if ! is_job_downloaded "$job_id"; then
      new_jobs+=("$job_id")
    fi
  done
  
  echo "  → Found ${#new_jobs[@]} new job(s) to download (latest versions only)"
  
  if [[ ${#new_jobs[@]} -eq 0 ]]; then
    echo "  ✅ No new jobs to download (all latest versions already cached)"
  else
    echo "==> Downloading ${#new_jobs[@]} latest version(s)..."
    
    for job_id in "${new_jobs[@]}"; do
      # Get job details from the list we already fetched
      job_info=$(echo "$job_list" | jq -r ".[] | select(.uid == \"$job_id\")")
      job_lang=$(echo "$job_info" | jq -r '.target_lang')
      job_filename=$(echo "$job_info" | jq -r '.filename')
      job_date=$(echo "$job_info" | jq -r '.date_created')
      
      echo "  → Job $job_id: language=$job_lang, file=$job_filename, created=$job_date"
      
      if download_job "$job_id" "$OUTPUT_DIR"; then
        # Mark as downloaded only after success (but not in dry-run mode)
        if [[ "$DRY_RUN" == false ]]; then
          mark_job_downloaded "$job_id" "$job_info"
        fi
      else
        ((download_errors++))
      fi
    done
  fi
fi

# Summary
if [[ $download_errors -gt 0 ]]; then
  echo "❌ Download failed: $download_errors job(s) had errors"
  exit 1
else
  echo "✅ Download complete: All jobs downloaded successfully"
  echo "  → Downloaded files are in: $OUTPUT_DIR"
fi
