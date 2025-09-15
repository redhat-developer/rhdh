# RHDH + community-plugins configuration
# This script is designed to run from the rhdh repository
RHDH_DIR="${RHDH_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
COMMUNITY_PLUGINS_DIR="${COMMUNITY_PLUGINS_DIR:-$HOME/redhat/community-plugins}"
REPO_ROOT="$RHDH_DIR"

# Note: rhdh-plugins translations are handled by dedicated scripts in that repository

# Release version (used for memsource-upload -v parameter and staging folder names)
RHDH_RELEASE="${RHDH_RELEASE:-1.8}"

# Sprint number (used for memsource-upload -s parameter)
SPRINT_NUMBER="${SPRINT_NUMBER:-3280}"

# TMS project id - Red Hat Developer Hub 1.8
TMS_PROJECT_ID="${TMS_PROJECT_ID:-33299484}"

# Staging dir (auto-derived from RHDH release)
STAGING_DIR="$REPO_ROOT/ui-i18n/$RHDH_RELEASE"


# Data center host (EU default; use https://us.cloud.memsource.com/web if on US DC)
export MEMSOURCE_HOST="${MEMSOURCE_HOST:-https://cloud.memsource.com/web}"

# DO NOT put username/password/token here.
# The runner script will read MEMSOURCE_USERNAME and MEMSOURCE_TOKEN from the user's env.

# ==============================================================================
# DOWNLOAD CONFIGURATION
# ==============================================================================

# Download directory - where translated files will be saved
DOWNLOAD_DIR="${DOWNLOAD_DIR:-$REPO_ROOT/ui-i18n-downloads/$RHDH_RELEASE}"

# Target languages to download (can be overridden)
DOWNLOAD_LANGS="${DOWNLOAD_LANGS:-fr}"

# Job status filter (only download completed jobs by default) 
JOB_STATUS_FILTER="${JOB_STATUS_FILTER:-COMPLETED}"

# File organization strategy:
# - "flat": All files in one directory 
# - "by-language": Organize by repository and plugin (community-plugins/plugin-name/, rhdh/ flat)
ORGANIZE_BY="${ORGANIZE_BY:-by-language}"

# Note: For multiple versions of the same source file, the download script 
# automatically selects the latest version based on creation timestamp.
# This ensures you always get the most recent translation.