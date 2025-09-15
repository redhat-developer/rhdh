#!/usr/bin/env bash
set -euo pipefail

# Main i18n download orchestration script
# Downloads completed translations from TMS and organizes them

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

show_usage() {
  echo "RHDH + Community Plugins - TMS Translation Download"
  echo ""
  echo "Usage: $0 [OPTIONS] [JOB_IDS...]"
  echo ""
  echo "Download Options:"
  echo "  --project-id ID    Override TMS project ID (default: from config)"
  echo "  --languages LANGS  Target languages, comma-separated (default: fr)" 
  echo "  --status STATUS    Job status filter: COMPLETED, NEW, etc. (default: COMPLETED)"
  echo "  --organize-by TYPE File organization: flat, by-language (repo/plugin) (default: by-language)"
  echo "  --output-dir DIR   Custom output directory (default: ui-i18n-downloads/VERSION)"
  echo ""
  echo "General Options:"
  echo "  --dry-run         Show what would be downloaded without actually doing it"
  echo "  --clean-before    Remove existing download directory before downloading"
  echo "  --help            Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0                                    # Download all completed French translations for rhdh + community-plugins"
  echo "  $0 --languages fr,es,de              # Download French, Spanish, German translations"
  echo "  $0 --organize-by flat                # Put all files in single directory"
  echo "  $0 WPHjtV9f8c9d8ls1DOyl50             # Download specific job ID"
  echo "  $0 --dry-run                         # Preview what would be downloaded"
  echo ""
  echo "Note: rhdh-plugins translations are processed by dedicated scripts in that repository"
  echo ""
}

# Parse command line arguments
OVERRIDE_PROJECT_ID=""
OVERRIDE_LANGUAGES=""
OVERRIDE_STATUS=""
OVERRIDE_ORGANIZE_BY=""
OVERRIDE_OUTPUT_DIR=""
DRY_RUN=false
CLEAN_BEFORE=false
JOB_IDS=()

while [[ $# -gt 0 ]]; do
  case $1 in
    --project-id)
      OVERRIDE_PROJECT_ID="$2"
      shift 2
      ;;
    --languages)
      OVERRIDE_LANGUAGES="$2"
      shift 2
      ;;
    --status)
      OVERRIDE_STATUS="$2"
      shift 2
      ;;
    --organize-by)
      OVERRIDE_ORGANIZE_BY="$2"
      shift 2
      ;;
    --output-dir)
      OVERRIDE_OUTPUT_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --clean-before)
      CLEAN_BEFORE=true
      shift
      ;;
    --help)
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
source "$SCRIPT_DIR/i18n.config.sh"

# Override config with command line arguments
[[ -n "$OVERRIDE_PROJECT_ID" ]] && TMS_PROJECT_ID="$OVERRIDE_PROJECT_ID"
[[ -n "$OVERRIDE_LANGUAGES" ]] && DOWNLOAD_LANGS="$OVERRIDE_LANGUAGES"
[[ -n "$OVERRIDE_STATUS" ]] && JOB_STATUS_FILTER="$OVERRIDE_STATUS"
[[ -n "$OVERRIDE_ORGANIZE_BY" ]] && ORGANIZE_BY="$OVERRIDE_ORGANIZE_BY"
[[ -n "$OVERRIDE_OUTPUT_DIR" ]] && DOWNLOAD_DIR="$OVERRIDE_OUTPUT_DIR"

echo "============================================="
echo "🌍 RHDH + Community Plugins Translation Download"
echo "============================================="
echo "Version: $RHDH_RELEASE"
echo "Project ID: $TMS_PROJECT_ID"
echo "Languages: $DOWNLOAD_LANGS"
echo "Status Filter: $JOB_STATUS_FILTER"
echo "Organization: $ORGANIZE_BY"
echo "Output Directory: $DOWNLOAD_DIR"
echo "Dry Run: $DRY_RUN"
echo ""

# Clean before download if requested
if [[ "$CLEAN_BEFORE" == true ]]; then
  echo "==> Cleaning download directory..."
  if [[ "$DRY_RUN" == true ]]; then
    echo "  → [DRY RUN] Would remove: $DOWNLOAD_DIR"
  else
    if [[ -d "$DOWNLOAD_DIR" ]]; then
      echo "  → Removing: $DOWNLOAD_DIR"
      rm -rf "$DOWNLOAD_DIR"
    else
      echo "  → Directory doesn't exist: $DOWNLOAD_DIR"
    fi
  fi
  echo ""
fi

# Create download directory structure
echo "==> Setting up download directories..."
if [[ "$DRY_RUN" == true ]]; then
  echo "  → [DRY RUN] Would create: $DOWNLOAD_DIR"
  if [[ "$ORGANIZE_BY" == "by-language" ]]; then
    echo "  → [DRY RUN] Would create plugin structure:"
    echo "    → community-plugins/[plugin-names]/"
    echo "    → rhdh/ (flat)"
    echo "    → Note: rhdh-plugins processed separately"
  fi
else
  mkdir -p "$DOWNLOAD_DIR"
  echo "  → Created: $DOWNLOAD_DIR"
  echo "  → Plugin-specific directories will be created as files are organized"
fi
echo ""

# Function to organize downloaded files
organize_files() {
  local temp_dir="$1"
  local final_dir="$2"
  
  echo "==> Organizing downloaded files..."
  
  case "$ORGANIZE_BY" in
    "flat")
      echo "  → Using flat organization"
      if [[ "$DRY_RUN" == false ]]; then
        find "$temp_dir" -name "*.json" -exec mv {} "$final_dir/" \;
      fi
      ;;
      
    "by-language")
      echo "  → Organizing by repository and plugin structure"
      
      if [[ "$DRY_RUN" == false ]]; then
        # Process each downloaded file
        find "$temp_dir" -name "*.json" | while read -r file; do
          if [[ -f "$file" ]]; then
            filename=$(basename "$file")
            
            # Split filename by __ to extract components
            IFS='__' read -ra PARTS <<< "$filename"
            
            repo_name="${PARTS[0]}"
            plugin_name=""
            
            # Determine target directory based on repository structure
            # Note: rhdh-plugins should be processed by scripts in that repository
            if [[ "$repo_name" == "community-plugins" ]]; then
              # Structure: community-plugins__workspaces__plugin-name__...
              # Extract plugin name (3rd component after repo__workspaces__)
              if [[ ${#PARTS[@]} -ge 3 ]]; then
                plugin_name="${PARTS[2]}"
                target_dir="$final_dir/$repo_name/$plugin_name"
              else
                target_dir="$final_dir/$repo_name/unknown"
              fi
            elif [[ "$repo_name" == "rhdh" ]]; then
              # For rhdh repository, keep flat structure
              target_dir="$final_dir/rhdh"
            elif [[ "$repo_name" == "rhdh-plugins" ]]; then
              # rhdh-plugins should be processed by scripts in that repository
              echo "    ⚠️  Skipping rhdh-plugins file (should be processed in rhdh-plugins repository): $(basename "$file")"
              continue
            else
              # Unknown repository structure
              target_dir="$final_dir/unknown"
            fi
            
            mkdir -p "$target_dir"
            mv "$file" "$target_dir/"
            
            if [[ -n "$plugin_name" ]]; then
              echo "    → $repo_name/$plugin_name: $(basename "$file")"
            else
              echo "    → $repo_name: $(basename "$file")"
            fi
          fi
        done
      else
        # Dry run - show structure that would be created
        echo "    → community-plugins/[plugin-name]: $final_dir/community-plugins/[plugin-name]/"
        echo "    → rhdh: $final_dir/rhdh/"
        echo "    → Note: rhdh-plugins processed separately in that repository"
      fi
      ;;
      
    "by-plugin")
      echo "  → Organizing by plugin structure"
      if [[ "$DRY_RUN" == false ]]; then
        # Attempt to reconstruct plugin structure from filename
        find "$temp_dir" -name "*.json" | while read -r file; do
          filename=$(basename "$file")
          
          # Parse filename like: rhdh-plugins__workspaces__plugin-name__...
          if [[ "$filename" =~ ^rhdh-plugins__workspaces__([^_]+)__ ]]; then
            plugin_name="${BASH_REMATCH[1]}"
            plugin_dir="$final_dir/plugins/$plugin_name"
            mkdir -p "$plugin_dir"
            mv "$file" "$plugin_dir/"
            echo "    → $plugin_name: $plugin_dir/$(basename "$file")"
          else
            # Fallback to flat organization for unrecognized patterns
            mv "$file" "$final_dir/"
            echo "    → unrecognized pattern: $final_dir/$(basename "$file")"
          fi
        done
      fi
      ;;
      
    *)
      echo "  ❌ Unknown organization type: $ORGANIZE_BY"
      exit 1
      ;;
  esac
}

# Download translations
echo "==> Downloading translations..."

if [[ "$DRY_RUN" == true ]]; then
  echo "  → [DRY RUN] Would run: memsource-download.sh"
  echo "    Project ID: $TMS_PROJECT_ID"
  echo "    Languages: $DOWNLOAD_LANGS"
  echo "    Status: $JOB_STATUS_FILTER"
  if [[ ${#JOB_IDS[@]} -gt 0 ]]; then
    echo "    Specific Jobs: ${JOB_IDS[*]}"
  else
    echo "    Jobs: All matching criteria"
  fi
else
  # Create temporary download directory
  TEMP_DOWNLOAD_DIR="$DOWNLOAD_DIR/.temp-download"
  mkdir -p "$TEMP_DOWNLOAD_DIR"
  
  # Build memsource-download command
  download_args=()
  download_args+=("-p" "$TMS_PROJECT_ID")
  download_args+=("-l" "$DOWNLOAD_LANGS")
  download_args+=("-s" "$JOB_STATUS_FILTER")
  download_args+=("-o" "$TEMP_DOWNLOAD_DIR")
  
  # Add job IDs if provided
  if [[ ${#JOB_IDS[@]} -gt 0 ]]; then
    download_args+=("${JOB_IDS[@]}")
  fi
  
  # Execute download
  if bash "$SCRIPT_DIR/memsource-download.sh" "${download_args[@]}"; then
    echo "  ✅ Download successful"
    
    # Organize files according to strategy
    organize_files "$TEMP_DOWNLOAD_DIR" "$DOWNLOAD_DIR"
    
    # Clean up temp directory
    rm -rf "$TEMP_DOWNLOAD_DIR"
    
    echo ""
    echo "==> Download Summary"
    
    # Count downloaded files
    total_files=$(find "$DOWNLOAD_DIR" -name "*.json" | wc -l)
    echo "  → Total files downloaded: $total_files"
    
    if [[ "$ORGANIZE_BY" == "by-language" ]]; then
      IFS=',' read -ra LANG_ARRAY <<< "$DOWNLOAD_LANGS"
      for lang in "${LANG_ARRAY[@]}"; do
        lang=$(echo "$lang" | xargs)
        lang_count=$(find "$DOWNLOAD_DIR/$lang" -name "*.json" 2>/dev/null | wc -l || echo "0")
        echo "    → $lang: $lang_count files"
      done
    fi
    
    echo "  → Files saved to: $DOWNLOAD_DIR"
    
  else
    echo "  ❌ Download failed"
    # Clean up temp directory on failure
    [[ -d "$TEMP_DOWNLOAD_DIR" ]] && rm -rf "$TEMP_DOWNLOAD_DIR"
    exit 1
  fi
fi

# Show version management info
echo ""
echo "==> Version Management"
echo "  → Strategy: Latest timestamp wins"
echo "  → Behavior: Automatically downloads the most recent version of each file"
echo "  → Use Case: When you upload updated ref.ts files, only the newest translation is downloaded"

# Show cache status (organized by release like upload cache)
CACHE_DIR="${REPO_ROOT}/.ui-i18n-download-cache/$RHDH_RELEASE"
if [[ -d "$CACHE_DIR" && $(find "$CACHE_DIR" -name "*" -type f | wc -l) -gt 0 ]]; then
  cached_jobs=$(find "$CACHE_DIR" -name "*" -type f | wc -l)
  echo "  → Cached jobs: $cached_jobs (prevents re-downloading)"
else
  echo "  → Cached jobs: 0 (all eligible jobs will be downloaded)"
fi

echo ""
echo "✅ Translation download complete!"

# Show next steps
echo ""
echo "==> Next Steps:"
echo "  1. Review downloaded translations: $DOWNLOAD_DIR"
echo "  2. Validate file formats and content"
echo "  3. Deploy to appropriate locations in your projects"
echo ""
