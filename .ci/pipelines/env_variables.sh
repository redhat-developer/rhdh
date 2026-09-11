#!/bin/bash
# shellcheck disable=SC2034
if [[ -n "${ENV_VARIABLES_SOURCED:-}" ]]; then
  return 0
fi
readonly ENV_VARIABLES_SOURCED=1

# shellcheck source=.ci/pipelines/lib/secrets.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/secrets.sh"

set -a # Automatically export all variables

# Define log file names and directories.
LOGFILE="test-log"

# Populated by OpenShift CI or the initial CI scripts
# Addition to JOB_NAME, TAG_NAME, SHARED_DIR, ARTIFACT_DIR
# This prevents nounset errors when running locally
# https://docs.ci.openshift.org/docs/architecture/step-registry/#available-environment-variables
# https://docs.prow.k8s.io/docs/jobs/#job-environment-variables
JOB_NAME="${JOB_NAME:-unknown-job}"
TAG_NAME="${TAG_NAME:-}"
OPENSHIFT_CI="${OPENSHIFT_CI:-false}"
REPO_OWNER="${REPO_OWNER:-redhat-developer}"
REPO_NAME="${REPO_NAME:-rhdh}"
PULL_NUMBER="${PULL_NUMBER:-}"
BUILD_ID="${BUILD_ID:-unknown-build}"
RELEASE_BRANCH_NAME="${RELEASE_BRANCH_NAME:-main}"

# Canonical version stem derived from RELEASE_BRANCH_NAME.
# 'release-1.10' -> '1.10', 'main' -> 'next'
# Used as the default tag for branch-aware image references (e.g., catalog index).
if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
  RELEASE_VERSION="next"
else
  RELEASE_VERSION="${RELEASE_BRANCH_NAME#release-}"
fi

K8S_CLUSTER_TOKEN="${K8S_CLUSTER_TOKEN:-}"
K8S_CLUSTER_URL="${K8S_CLUSTER_URL:-}"
SHARED_DIR="${SHARED_DIR:-$DIR/shared_dir}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$DIR/artifact_dir}"
mkdir -p "${SHARED_DIR}"
mkdir -p "${ARTIFACT_DIR}"

# Environment and secret values
HELM_CHART_VALUE_FILE_NAME="values_showcase.yaml"
HELM_CHART_RBAC_VALUE_FILE_NAME="values_showcase-rbac.yaml"
HELM_CHART_K8S_MERGED_VALUE_FILE_NAME="merged-values_showcase_K8S.yaml"
HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME="merged-values_showcase-rbac_K8S.yaml"
HELM_CHART_AKS_DIFF_VALUE_FILE_NAME="diff-values_showcase_AKS.yaml"
HELM_CHART_RBAC_AKS_DIFF_VALUE_FILE_NAME="diff-values_showcase-rbac_AKS.yaml"
HELM_CHART_GKE_DIFF_VALUE_FILE_NAME="diff-values_showcase_GKE.yaml"
HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME="diff-values_showcase-rbac_GKE.yaml"
HELM_CHART_EKS_DIFF_VALUE_FILE_NAME="diff-values_showcase_EKS.yaml"
HELM_CHART_RBAC_EKS_DIFF_VALUE_FILE_NAME="diff-values_showcase-rbac_EKS.yaml"
HELM_CHART_SANITY_PLUGINS_DIFF_VALUE_FILE_NAME="diff-values_showcase-sanity-plugins.yaml"
HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME="merged-values_showcase-sanity-plugins.yaml"

HELM_CHART_URL="oci://quay.io/rhdh/chart"
K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
IMAGE_REGISTRY="${IMAGE_REGISTRY:-quay.io}"
IMAGE_REPO="${IMAGE_REPO:-${QUAY_REPO:-rhdh-community/rhdh}}"
QUAY_REPO="${IMAGE_REPO}" # Keep QUAY_REPO in sync for backward compatibility

# Catalog index image, derived from RELEASE_VERSION (main → :next, release-1.10 → :1.10).
# Per-run (RC/GA/mirror): non-empty CATALOG_INDEX_IMAGE wins (Gangway / --catalog-index-image).
if [[ -z "${CATALOG_INDEX_IMAGE:-}" ]]; then
  CATALOG_INDEX_IMAGE="quay.io/rhdh/plugin-catalog-index:${RELEASE_VERSION}"
fi
if [[ -n "${CATALOG_INDEX_IMAGE}" ]]; then
  # Derived components for Helm --set global.catalogIndex.image.{registry,repository,tag}
  CATALOG_INDEX_TAG="${CATALOG_INDEX_IMAGE##*:}"
  _CI_WITHOUT_TAG="${CATALOG_INDEX_IMAGE%:*}"
  CATALOG_INDEX_REGISTRY="${_CI_WITHOUT_TAG%%/*}"
  CATALOG_INDEX_REPO="${_CI_WITHOUT_TAG#*/}"
  unset _CI_WITHOUT_TAG
else
  unset CATALOG_INDEX_TAG CATALOG_INDEX_REGISTRY CATALOG_INDEX_REPO
fi

# Default PostgreSQL image for RHDH deployments when the source (Helm chart /
# CR) does not pin one. Matches the showcase value files
# (value_files/diff-values_showcase-rbac_*.yaml): quay.io/fedora/postgresql-15.
# The community chart historically defaulted to registry.redhat.io/rhel9/...,
# which is not pullable without a Red Hat pull secret in every environment.
POSTGRESQL_IMAGE_REGISTRY="${POSTGRESQL_IMAGE_REGISTRY:-quay.io}"
POSTGRESQL_IMAGE_REPO="${POSTGRESQL_IMAGE_REPO:-fedora/postgresql-15}"
POSTGRESQL_IMAGE_TAG="${POSTGRESQL_IMAGE_TAG:-latest}"

# =============================================================================
# Release and Namespace Configuration
# These can be overridden by CI environment or local configuration
# =============================================================================
RELEASE_NAME=rhdh
RELEASE_NAME_RBAC=rhdh-rbac

# Default namespaces (override via environment for different environments)
: "${NAME_SPACE:=showcase}"                               # Standard deployment namespace
: "${NAME_SPACE_RBAC:=showcase-rbac}"                     # RBAC-enabled deployment namespace
: "${NAME_SPACE_RUNTIME:=showcase-runtime}"               # Runtime configuration tests namespace
: "${NAME_SPACE_POSTGRES_DB:=postgress-external-db}"      # External PostgreSQL database namespace
NAME_SPACE_SANITY_PLUGINS_CHECK="showcase-sanity-plugins" # Sanity check namespace (fixed)

# Operator configuration
OPERATOR_MANAGER='rhdh-operator'
CHART_MAJOR_VERSION="1.9"
GITHUB_URL=aHR0cHM6Ly9naXRodWIuY29t
GITHUB_ORG=amFudXMtcWU=
GITHUB_ORG_2=amFudXMtdGVzdA==

# Import mounted CI secrets once. Local Bitwarden runs inject the same names
# into the environment, so the loader is intentionally a no-op without the
# mounted directory.
secrets::load_directory "/tmp/secrets"

ENCODED_CLUSTER_NAME=$(echo "my-cluster" | base64)
K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED

# External Database credentials
## RDS Database for PostgreSQL credentials
## Azure Database for PostgreSQL credentials
# Database TLS certificates remain file paths to avoid loading PEM content into
# the process environment.
RHDH_RDS_CERTIFICATE_PATH_CANDIDATE=""
if [[ -d "/tmp/secrets" ]] \
  && RHDH_RDS_CERTIFICATE_PATH_CANDIDATE=$(secrets::file_path "/tmp/secrets" rds-db-certificates.pem); then
  RDS_DB_CERTIFICATES_PATH="${RHDH_RDS_CERTIFICATE_PATH_CANDIDATE}"
  export RDS_DB_CERTIFICATES_PATH
elif [[ -n "${rds_db_certificates_pem+x}" ]]; then
  if RDS_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
    "${SHARED_DIR}/.rhdh-secrets" rds_db_certificates_pem rds-db-certificates.pem); then
    export RDS_DB_CERTIFICATES_PATH
  fi
elif [[ -n "${rds_db_certificates__dot__pem+x}" ]]; then
  if RDS_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
    "${SHARED_DIR}/.rhdh-secrets" rds_db_certificates__dot__pem rds-db-certificates.pem); then
    export RDS_DB_CERTIFICATES_PATH
  fi
fi
RHDH_AZURE_CERTIFICATE_PATH_CANDIDATE=""
if [[ -d "/tmp/secrets" ]] \
  && RHDH_AZURE_CERTIFICATE_PATH_CANDIDATE=$(secrets::file_path "/tmp/secrets" azure-db-certificates.pem); then
  AZURE_DB_CERTIFICATES_PATH="${RHDH_AZURE_CERTIFICATE_PATH_CANDIDATE}"
  export AZURE_DB_CERTIFICATES_PATH
elif [[ -n "${azure_db_certificates_pem+x}" ]]; then
  if AZURE_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
    "${SHARED_DIR}/.rhdh-secrets" azure_db_certificates_pem azure-db-certificates.pem); then
    export AZURE_DB_CERTIFICATES_PATH
  fi
elif [[ -n "${azure_db_certificates__dot__pem+x}" ]]; then
  if AZURE_DB_CERTIFICATES_PATH=$(secrets::file_from_environment \
    "${SHARED_DIR}/.rhdh-secrets" azure_db_certificates__dot__pem azure-db-certificates.pem); then
    export AZURE_DB_CERTIFICATES_PATH
  fi
fi
unset RHDH_RDS_CERTIFICATE_PATH_CANDIDATE RHDH_AZURE_CERTIFICATE_PATH_CANDIDATE

JUNIT_RESULTS="junit-results.xml"

REDIS_USERNAME=temp
REDIS_USERNAME_ENCODED=$(printf "%s" $REDIS_USERNAME | base64 | tr -d '\n')
REDIS_PASSWORD=test123
REDIS_PASSWORD_ENCODED=$(printf "%s" $REDIS_PASSWORD | base64 | tr -d '\n')

# GKE variables

# EKS variables

# authentication providers variables
secrets::alias RHBK_BASE_URL AUTH_PROVIDERS_RHBK_BASE_URL
secrets::alias RHBK_CLIENT_SECRET AUTH_PROVIDERS_RHBK_CLIENT_SECRET
secrets::alias RHBK_CLIENT_ID AUTH_PROVIDERS_RHBK_CLIENT_ID
secrets::alias RHBK_REALM AUTH_PROVIDERS_RHBK_REALM
secrets::alias DEFAULT_USER_PASSWORD AUTH_PROVIDERS_DEFAULT_USER_PASSWORD
secrets::alias DEFAULT_USER_PASSWORD_2 AUTH_PROVIDERS_DEFAULT_USER_PASSWORD_2

IS_OPENSHIFT="${IS_OPENSHIFT:-true}"
CONTAINER_PLATFORM="${CONTAINER_PLATFORM:-unknown}"
CONTAINER_PLATFORM_VERSION="${CONTAINER_PLATFORM_VERSION:-unknown}"

GITHUB_OAUTH_APP_ID_ENCODED=$(printf "%s" $GITHUB_OAUTH_APP_ID | base64 | tr -d '\n')
GITHUB_OAUTH_APP_SECRET_ENCODED=$(printf "%s" $GITHUB_OAUTH_APP_SECRET | base64 | tr -d '\n')

BACKEND_SECRET=$(printf temp | base64 | tr -d '\n')

# GitHub App env vars for rotation (per-job override via override_github_app_env_with_prefix in utils.sh).
# Source values are imported from CI files or inherited from local Bitwarden.

# Old GitHub App env vars, kept for backward compatibility
GITHUB_APP_JANUS_TEST_APP_ID=OTE3NjM5
GITHUB_APP_JANUS_TEST_CLIENT_ID=SXYyM2xpSEdtU1l6SUFEbHFIakw=
#
# New GitHub App env vars for showcase
#

# Default GitHub App env vars for showcase
secrets::alias GITHUB_APP_APP_ID GITHUB_APP_3_APP_ID
secrets::alias GITHUB_APP_CLIENT_ID GITHUB_APP_3_CLIENT_ID
secrets::alias GITHUB_APP_PRIVATE_KEY GITHUB_APP_3_PRIVATE_KEY
secrets::alias GITHUB_APP_CLIENT_SECRET GITHUB_APP_3_CLIENT_SECRET
GITHUB_APP_WEBHOOK_URL=aHR0cHM6Ly9zbWVlLmlvL0NrRUNLYVgwNzhyZVhobEpEVzA=
secrets::alias GITHUB_APP_WEBHOOK_SECRET GITHUB_APP_WEBHOOK_SECRET

secrets::alias GITHUB_APP_APP_ID_1 GITHUB_APP_3_APP_ID
secrets::alias GITHUB_APP_CLIENT_ID_1 GITHUB_APP_3_CLIENT_ID
secrets::alias GITHUB_APP_PRIVATE_KEY_1 GITHUB_APP_3_PRIVATE_KEY
secrets::alias GITHUB_APP_CLIENT_SECRET_1 GITHUB_APP_3_CLIENT_SECRET
GITHUB_APP_WEBHOOK_URL_1=aHR0cHM6Ly9zbWVlLmlvL0NrRUNLYVgwNzhyZVhobEpEVzA=
secrets::alias GITHUB_APP_WEBHOOK_SECRET_1 GITHUB_APP_WEBHOOK_SECRET

secrets::alias GITHUB_APP_APP_ID_2 GITHUB_APP_APP_ID_AKS
secrets::alias GITHUB_APP_CLIENT_ID_2 GITHUB_APP_CLIENT_ID_AKS
secrets::alias GITHUB_APP_PRIVATE_KEY_2 GITHUB_APP_PRIVATE_KEY_AKS
secrets::alias GITHUB_APP_CLIENT_SECRET_2 GITHUB_APP_CLIENT_SECRET_AKS
secrets::alias GITHUB_APP_WEBHOOK_URL_2 GITHUB_APP_WEBHOOK_URL_AKS
secrets::alias GITHUB_APP_WEBHOOK_SECRET_2 GITHUB_APP_WEBHOOK_SECRET_AKS

secrets::alias GITHUB_APP_APP_ID_3 GITHUB_APP_APP_ID_EKS
secrets::alias GITHUB_APP_CLIENT_ID_3 GITHUB_APP_CLIENT_ID_EKS
secrets::alias GITHUB_APP_PRIVATE_KEY_3 GITHUB_APP_PRIVATE_KEY_EKS
secrets::alias GITHUB_APP_CLIENT_SECRET_3 GITHUB_APP_CLIENT_SECRET_EKS
secrets::alias GITHUB_APP_WEBHOOK_URL_3 GITHUB_APP_WEBHOOK_URL_EKS
secrets::alias GITHUB_APP_WEBHOOK_SECRET_3 GITHUB_APP_WEBHOOK_SECRET_EKS

secrets::alias GITHUB_APP_APP_ID_4 GITHUB_APP_APP_ID_GKE
secrets::alias GITHUB_APP_CLIENT_ID_4 GITHUB_APP_CLIENT_ID_GKE
secrets::alias GITHUB_APP_PRIVATE_KEY_4 GITHUB_APP_PRIVATE_KEY_GKE
secrets::alias GITHUB_APP_CLIENT_SECRET_4 GITHUB_APP_CLIENT_SECRET_GKE
secrets::alias GITHUB_APP_WEBHOOK_URL_4 GITHUB_APP_WEBHOOK_URL_GKE
secrets::alias GITHUB_APP_WEBHOOK_SECRET_4 GITHUB_APP_WEBHOOK_SECRET_GKE

secrets::alias GITHUB_APP_APP_ID_5 GITHUB_APP_APP_ID_HELM
secrets::alias GITHUB_APP_CLIENT_ID_5 GITHUB_APP_CLIENT_ID_HELM
secrets::alias GITHUB_APP_PRIVATE_KEY_5 GITHUB_APP_PRIVATE_KEY_HELM
secrets::alias GITHUB_APP_CLIENT_SECRET_5 GITHUB_APP_CLIENT_SECRET_HELM
secrets::alias GITHUB_APP_WEBHOOK_URL_5 GITHUB_APP_WEBHOOK_URL_HELM
secrets::alias GITHUB_APP_WEBHOOK_SECRET_5 GITHUB_APP_WEBHOOK_SECRET_HELM

#
# New GitHub App env vars for showcase-rbac
#

#Default GitHub App env vars for showcase-rbac
secrets::alias GITHUB_APP_APP_ID_RBAC GITHUB_APP_APP_ID_OPERATOR
secrets::alias GITHUB_APP_CLIENT_ID_RBAC GITHUB_APP_CLIENT_ID_OPERATOR
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC GITHUB_APP_CLIENT_SECRET_OPERATOR
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC GITHUB_APP_WEBHOOK_URL_OPERATOR
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC GITHUB_APP_WEBHOOK_SECRET_OPERATOR

secrets::alias GITHUB_APP_APP_ID_RBAC_1 GITHUB_APP_APP_ID_OPERATOR
secrets::alias GITHUB_APP_CLIENT_ID_RBAC_1 GITHUB_APP_CLIENT_ID_OPERATOR
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC_1 GITHUB_APP_PRIVATE_KEY_OPERATOR
secrets::alias GITHUB_APP_CLIENT_SECRET_RBAC_1 GITHUB_APP_CLIENT_SECRET_OPERATOR
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC_1 GITHUB_APP_WEBHOOK_URL_OPERATOR
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC_1 GITHUB_APP_WEBHOOK_SECRET_OPERATOR

secrets::alias GITHUB_APP_APP_ID_RBAC_2 GITHUB_APP_APP_ID_OSD
secrets::alias GITHUB_APP_CLIENT_ID_RBAC_2 GITHUB_APP_CLIENT_ID_OSD
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC_2 GITHUB_APP_PRIVATE_KEY_OSD
secrets::alias GITHUB_APP_CLIENT_SECRET_RBAC_2 GITHUB_APP_CLIENT_SECRET_OSD
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC_2 GITHUB_APP_WEBHOOK_URL_OSD
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC_2 GITHUB_APP_WEBHOOK_SECRET_OSD

secrets::alias GITHUB_APP_APP_ID_RBAC_3 GITHUB_APP_APP_ID_HELM_PR
secrets::alias GITHUB_APP_CLIENT_ID_RBAC_3 GITHUB_APP_CLIENT_ID_HELM_PR
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC_3 GITHUB_APP_PRIVATE_KEY_HELM_PR
secrets::alias GITHUB_APP_CLIENT_SECRET_RBAC_3 GITHUB_APP_CLIENT_SECRET_HELM_PR
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC_3 GITHUB_APP_WEBHOOK_URL_HELM_PR
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC_3 GITHUB_APP_WEBHOOK_SECRET_HELM_PR

secrets::alias GITHUB_APP_APP_ID_RBAC_4 GITHUB_APP_APP_ID_HELM_PR_2
secrets::alias GITHUB_APP_CLIENT_ID_RBAC_4 GITHUB_APP_CLIENT_ID_HELM_PR_2
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC_4 GITHUB_APP_PRIVATE_KEY_HELM_PR_2
secrets::alias GITHUB_APP_CLIENT_SECRET_RBAC_4 GITHUB_APP_CLIENT_SECRET_HELM_PR_2
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC_4 GITHUB_APP_WEBHOOK_URL_HELM_PR_2
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC_4 GITHUB_APP_WEBHOOK_SECRET_HELM_PR_2

secrets::alias GITHUB_APP_APP_ID_RBAC_5 GITHUB_APP_APP_ID_HELM_PR_3
secrets::alias GITHUB_APP_CLIENT_ID_RBAC_5 GITHUB_APP_CLIENT_ID_HELM_PR_3
secrets::alias GITHUB_APP_PRIVATE_KEY_RBAC_5 GITHUB_APP_PRIVATE_KEY_HELM_PR_3
secrets::alias GITHUB_APP_CLIENT_SECRET_RBAC_5 GITHUB_APP_CLIENT_SECRET_HELM_PR_3
secrets::alias GITHUB_APP_WEBHOOK_URL_RBAC_5 GITHUB_APP_WEBHOOK_URL_HELM_PR_3
secrets::alias GITHUB_APP_WEBHOOK_SECRET_RBAC_5 GITHUB_APP_WEBHOOK_SECRET_HELM_PR_3

set +a # Stop automatically exporting variables
