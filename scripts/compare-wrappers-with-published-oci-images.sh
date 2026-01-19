#!/bin/bash

# Script to compare wrapper plugin versions with latest OCI artifact versions
# from ghcr.io/redhat-developer/rhdh-plugin-export-overlays
#
# Prerequisites: skopeo, jq
#
# Usage: ./compare-versions.sh [--markdown|--json] [wrapper-pattern]
#   --markdown      : Output in Markdown format (default)
#   --json          : Output in JSON format
#   wrapper-pattern : Optional regex pattern to filter wrappers (e.g., "3scale", "tekton.*backend")

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPERS_DIR="$SCRIPT_DIR/../dynamic-plugins/wrappers"
OCI_REGISTRY="ghcr.io/redhat-developer/rhdh-plugin-export-overlays"
GITHUB_REPO="https://github.com/redhat-developer/rhdh"
GITHUB_PACKAGES="https://github.com/redhat-developer/rhdh-plugin-export-overlays/pkgs/container/rhdh-plugin-export-overlays%2F"

# Parse arguments
OUTPUT_FORMAT="markdown"
WRAPPER_PATTERN=""

for arg in "$@"; do
  case "$arg" in
    --markdown) OUTPUT_FORMAT="markdown" ;;
    --json) OUTPUT_FORMAT="json" ;;
    --help|-h)
      echo "Usage: $0 [--markdown|--json] [wrapper-pattern]"
      echo ""
      echo "Options:"
      echo "  --markdown       Output in Markdown format (default)"
      echo "  --json           Output in JSON format"
      echo "  wrapper-pattern  Optional regex pattern to filter wrappers"
      echo ""
      echo "Examples:"
      echo "  $0                         # Compare all wrappers (markdown)"
      echo "  $0 --json                  # Compare all wrappers (JSON)"
      echo "  $0 3scale                  # All wrappers matching '3scale'"
      echo "  $0 'tekton.*backend'       # Regex: tekton backends"
      echo "  $0 --json '^backstage-plugin-aap'  # Starts with 'backstage-plugin-aap'"
      exit 0
      ;;
    -*)
      echo "Unknown option: $arg" >&2
      echo "Use --help for usage information" >&2
      exit 1
      ;;
    *)
      # Non-option argument is treated as wrapper pattern (regex)
      WRAPPER_PATTERN="$arg"
      ;;
  esac
done

# Check prerequisites
if ! command -v skopeo &> /dev/null; then
  echo "Error: skopeo is required but not installed." >&2
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "Error: jq is required but not installed." >&2
  exit 1
fi

# Function to convert npm package name to OCI artifact name
# @red-hat-developer-hub/backstage-plugin-adoption-insights -> red-hat-developer-hub-backstage-plugin-adoption-insights
# @backstage-community/plugin-acr -> backstage-community-plugin-acr
npm_to_oci_name() {
  local npm_name="$1"
  # Remove @ prefix and replace / with -
  echo "$npm_name" | sed 's/^@//' | sed 's/\//-/'
}

# Function to get the main plugin dependency from package.json
# Returns: "dependency_name:version:line_number"
get_main_dependency() {
  local pkg_json="$1"
  
  if [[ ! -f "$pkg_json" ]]; then
    echo "NOT_FOUND:NOT_FOUND:1"
    return
  fi
  
  # Get dependencies that match plugin patterns (exclude cli, core-plugin-api, -common, -node, etc.)
  # Look for @red-hat-developer-hub/, @backstage-community/, @backstage/plugin-, @roadiehq/
  local dep_info
  dep_info=$(jq -r '
    .dependencies // {} | to_entries[] | 
    select(
      (.key | startswith("@red-hat-developer-hub/")) or
      (.key | startswith("@backstage-community/")) or
      (.key | startswith("@backstage/plugin-")) or
      (.key | startswith("@roadiehq/"))
    ) |
    select(
      (.key | contains("cli") | not) and
      (.key | contains("core-plugin-api") | not) and
      (.key | contains("catalog-react") | not) and
      (.key | contains("search-react") | not) and
      (.key | contains("techdocs-react") | not) and
      (.key | contains("backend-plugin-api") | not) and
      (.key | endswith("-common") | not) and
      (.key | endswith("-node") | not) and
      (.key | contains("-react") | not)
    ) |
    "\(.key):\(.value)"
  ' "$pkg_json" | head -1)
  
  if [[ -z "$dep_info" ]]; then
    echo "NOT_FOUND:NOT_FOUND:1"
    return
  fi
  
  local dep_name="${dep_info%%:*}"
  local dep_version="${dep_info#*:}"
  
  # Get line number - search only within the dependencies section (after "dependencies":)
  local line_num
  local deps_start
  deps_start=$(grep -n '"dependencies"' "$pkg_json" | head -1 | cut -d: -f1)
  if [[ -n "$deps_start" ]]; then
    # Search for the dependency starting from the dependencies section
    line_num=$(tail -n +"$deps_start" "$pkg_json" | grep -n "\"$dep_name\"" | head -1 | cut -d: -f1)
    if [[ -n "$line_num" ]]; then
      line_num=$((deps_start + line_num - 1))
    fi
  fi
  [[ -z "$line_num" ]] && line_num="1"
  
  echo "$dep_name:$dep_version:$line_num"
}

# Function to get latest OCI version (excluding pr_* and next__* tags)
get_oci_version() {
  local oci_name="$1"
  local tags
  
  tags=$(skopeo list-tags --tls-verify=false "docker://$OCI_REGISTRY/$oci_name" 2>/dev/null || echo '{"Tags":[]}')
  
  # Filter for bs_1.45* tags and get the latest one
  local version
  version=$(echo "$tags" | jq -r '[.Tags[] | select(startswith("bs_1.45"))] | last // "NOT_FOUND"')
  
  if [[ "$version" == "NOT_FOUND" || "$version" == "null" ]]; then
    echo "NOT_FOUND"
  else
    # Extract version from tag (e.g., bs_1.45.3__0.6.2 -> 0.6.2)
    echo "$version" | sed 's/bs_[^_]*__//'
  fi
}

# Arrays to store results
declare -a MATCHING=()
declare -a OUTDATED=()
declare -a NOT_IN_OCI=()
declare -a JSON_RESULTS=()

# Validate wrapper pattern if provided
if [[ -n "$WRAPPER_PATTERN" ]]; then
  # Check if pattern matches any wrapper
  matching_count=$(ls -1 "$WRAPPERS_DIR" | grep -E "$WRAPPER_PATTERN" | wc -l)
  if [[ "$matching_count" -eq 0 ]]; then
    echo "Error: No wrappers match pattern '$WRAPPER_PATTERN'" >&2
    echo "Available wrappers:" >&2
    ls -1 "$WRAPPERS_DIR" | head -10 >&2
    echo "..." >&2
    exit 1
  fi
  echo "Pattern '$WRAPPER_PATTERN' matches $matching_count wrapper(s)" >&2
fi

# Process each wrapper directory
for wrapper_dir in "$WRAPPERS_DIR"/*/; do
  wrapper_name=$(basename "$wrapper_dir")
  
  # If pattern is set, skip non-matching wrappers (using grep regex)
  if [[ -n "$WRAPPER_PATTERN" ]] && ! echo "$wrapper_name" | grep -qE "$WRAPPER_PATTERN"; then
    continue
  fi
  
  echo -n '.' >&2
  pkg_json="$wrapper_dir/package.json"
  
  # Skip non-plugin directories
  [[ ! -f "$pkg_json" ]] && continue
  
  # Get main dependency info
  dep_info=$(get_main_dependency "$pkg_json")
  dep_name="${dep_info%%:*}"
  rest="${dep_info#*:}"
  wrapper_version="${rest%%:*}"
  line_num="${rest##*:}"
  
  # Skip if no valid dependency found
  [[ "$dep_name" == "NOT_FOUND" ]] && continue
  
  # Derive OCI artifact name from dependency
  oci_name=$(npm_to_oci_name "$dep_name")
  
  # Get OCI version
  oci_version=$(get_oci_version "$oci_name")
  
  # Build links
  wrapper_link="$GITHUB_REPO/blob/main/dynamic-plugins/wrappers/$wrapper_name/package.json#L$line_num"
  oci_link="$GITHUB_PACKAGES$oci_name"
  
  # Determine match status
  if [[ "$oci_version" == "NOT_FOUND" ]]; then
    is_match="null"
    NOT_IN_OCI+=("$wrapper_name|$dep_name|$wrapper_version|$wrapper_link")
  elif [[ "$wrapper_version" == "$oci_version" ]]; then
    is_match="true"
    MATCHING+=("$wrapper_name|$wrapper_version|$oci_version|$wrapper_link|$oci_link")
  else
    is_match="false"
    OUTDATED+=("$wrapper_name|$wrapper_version|$oci_version|$wrapper_link|$oci_link")
  fi
  
  # Store JSON result
  JSON_RESULTS+=("{\"wrapper\":\"$wrapper_name\",\"oci_artifact\":\"$oci_name\",\"dependency\":\"$dep_name\",\"wrapper_version\":\"$wrapper_version\",\"oci_version\":\"$oci_version\",\"match\":$is_match,\"wrapper_link\":\"$wrapper_link\",\"oci_link\":\"$oci_link\"}")
done

echo >&2

# Output based on format
case "$OUTPUT_FORMAT" in
  json)
    echo "{"
    echo "  \"generated\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\","
    echo "  \"oci_registry\": \"$OCI_REGISTRY\","
    if [[ -n "$WRAPPER_PATTERN" ]]; then
      echo "  \"filter\": \"$WRAPPER_PATTERN\","
    fi
    echo "  \"summary\": {"
    echo "    \"total\": ${#JSON_RESULTS[@]},"
    echo "    \"matching\": ${#MATCHING[@]},"
    echo "    \"outdated\": ${#OUTDATED[@]},"
    echo "    \"not_in_oci\": ${#NOT_IN_OCI[@]}"
    echo "  },"
    echo "  \"results\": ["
    for i in "${!JSON_RESULTS[@]}"; do
      if [[ $i -lt $((${#JSON_RESULTS[@]} - 1)) ]]; then
        echo "    ${JSON_RESULTS[$i]},"
      else
        echo "    ${JSON_RESULTS[$i]}"
      fi
    done
    echo "  ]"
    echo "}"
    ;;
    
  markdown)
    echo "# Wrapper vs OCI Artifact Version Comparison"
    echo ""
    echo "This table compares the plugin versions used in the backstage-showcase wrappers with the latest published OCI artifacts from [rhdh-plugin-export-overlays](https://github.com/orgs/redhat-developer/packages?repo_name=rhdh-plugin-export-overlays)."
    echo ""
    echo "> **Generated on:** $(date +%Y-%m-%d)"
    echo ">"
    echo "> **OCI Registry:** \`$OCI_REGISTRY/\`"
    if [[ -n "$WRAPPER_PATTERN" ]]; then
      echo ">"
      echo "> **Filter:** \`$WRAPPER_PATTERN\`"
    fi
    echo ""
    echo "## Comparison Table"
    echo ""
    echo "| Wrapper | Wrapper Version | Latest OCI Version | Match? |"
    echo "|---------|-----------------|-------------------|--------|"
    
    for item in "${MATCHING[@]}"; do
      IFS='|' read -r wrapper wrapper_ver oci_ver wrapper_link oci_link <<< "$item"
      echo "| \`$wrapper\` | [$wrapper_ver]($wrapper_link) | [$oci_ver]($oci_link) | ✅ |"
    done
    
    for item in "${OUTDATED[@]}"; do
      IFS='|' read -r wrapper wrapper_ver oci_ver wrapper_link oci_link <<< "$item"
      echo "| \`$wrapper\` | [$wrapper_ver]($wrapper_link) | [$oci_ver]($oci_link) | ❌ |"
    done
    
    for item in "${NOT_IN_OCI[@]}"; do
      IFS='|' read -r wrapper dep_name wrapper_ver wrapper_link <<< "$item"
      echo "| \`$wrapper\` | [$wrapper_ver]($wrapper_link) | _not in OCI registry_ | ⚪ |"
    done
    
    echo ""
    echo "## Summary"
    echo ""
    echo "| Status | Count | Description |"
    echo "|--------|-------|-------------|"
    echo "| ✅ | ${#MATCHING[@]} | Wrappers matching latest OCI artifact version |"
    echo "| ❌ | ${#OUTDATED[@]} | Wrappers outdated compared to OCI artifacts |"
    echo "| ⚪ | ${#NOT_IN_OCI[@]} | Wrappers not found in OCI registry |"
    ;;
esac
