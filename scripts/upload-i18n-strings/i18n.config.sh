# Update directory paths to match your local setup
RHDH_DIR="${RHDH_DIR:-$HOME/redhat/rhdh}"
RHDH_PLUGINS_DIR="${RHDH_PLUGINS_DIR:-$HOME/redhat/rhdh-plugins}"
COMMUNITY_PLUGINS_DIR="${COMMUNITY_PLUGINS_DIR:-$HOME/redhat/community-plugins}"

# Release version (used for memsource-upload -v parameter and staging folder names)
RHDH_RELEASE="${RHDH_RELEASE:-1.8}"

# Sprint number (used for memsource-upload -s parameter)
SPRINT_NUMBER="${SPRINT_NUMBER:-3279}"

# TMS project id - Red Hat Developer Hub 1.8
TMS_PROJECT_ID="${TMS_PROJECT_ID:-33299484}"

# Staging dir (auto-derived from RHDH release)
STAGING_DIR="$REPO_ROOT/ui-i18n/$RHDH_RELEASE"


# Data center host (EU default; use https://us.cloud.memsource.com/web if on US DC)
export MEMSOURCE_HOST="${MEMSOURCE_HOST:-https://cloud.memsource.com/web}"

# DO NOT put username/password/token here.
# The runner script will read MEMSOURCE_USERNAME and MEMSOURCE_TOKEN from the user's env.