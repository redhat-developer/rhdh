#!/usr/bin/env bash
set -euo pipefail

# Main deployment script for Orchestrator infrastructure
# Self-contained project - does not depend on external files

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Default variables
NAMESPACE="orchestrator-infra"
ENABLE_KEYCLOAK="true"
ENABLE_GITOPS="false"
CLEAN="true"
VERBOSE=""
DRY_RUN="false"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }
warn() { echo -e "${YELLOW}[WARN]${NC} $*"; }
info() { echo -e "${BLUE}[INFO]${NC} $*"; }

print_help() {
  cat << EOF
Usage: $(basename "$0") [OPTIONS]

Deploy Orchestrator Infrastructure without RHDH/Backstage

This script deploys:
  - PostgreSQL database for Orchestrator
  - Serverless Logic Operator
  - SonataFlow Platform (Data Index + Job Service)
  - Keycloak for authentication (optional)
  - Sample workflows
  - GitOps configuration (optional)

Options:
  --namespace NAME        Namespace to deploy (default: orchestrator-infra)
  --no-keycloak          Skip Keycloak deployment
  --enable-gitops        Enable GitOps/ArgoCD configuration
  --no-clean             Don't delete existing namespace
  --verbose              Enable verbose output
  --dry-run              Show what would be executed
  -h, --help             Show this help message

Examples:
  # Basic deployment
  $(basename "$0")
  
  # Deploy without Keycloak
  $(basename "$0") --no-keycloak
  
  # Deploy with GitOps
  $(basename "$0") --enable-gitops
  
  # Update existing deployment
  $(basename "$0") --no-clean

Integration with RHDH/Backstage:
  After deployment, configure your Backstage instance with:
  - PostgreSQL: postgresql.\${namespace}.svc.cluster.local:5432
  - Data Index: http://sonataflow-platform-data-index-service.\${namespace}
  
  Note: The Orchestrator plugin automatically appends /graphql to the URL.
        The service uses port 80 by default. Full URL with port:
        http://sonataflow-platform-data-index-service.\${namespace}.svc.cluster.local:80

EOF
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --namespace)
      NAMESPACE="$2"
      shift 2
      ;;
    --no-keycloak)
      ENABLE_KEYCLOAK="false"
      shift
      ;;
    --enable-gitops)
      ENABLE_GITOPS="true"
      shift
      ;;
    --no-clean)
      CLEAN="false"
      shift
      ;;
    --verbose)
      VERBOSE="-vv"
      shift
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h | --help)
      print_help
      exit 0
      ;;
    *)
      error "Unknown option: $1"
      print_help
      exit 1
      ;;
  esac
done

# Check prerequisites
log "Checking prerequisites..."

if ! command -v oc > /dev/null 2>&1; then
  error "oc CLI not installed. Please install OpenShift CLI."
  exit 1
fi

if ! command -v ansible-playbook > /dev/null 2>&1; then
  error "ansible-playbook not installed. Please install Ansible."
  exit 1
fi

if ! oc whoami > /dev/null 2>&1; then
  error "Not logged into OpenShift. Please run 'oc login' first."
  exit 1
fi

info "Cluster: $(oc whoami --show-console 2> /dev/null || echo "unknown")"
info "User: $(oc whoami)"

# Check Python kubernetes library
if ! python3 -c "import kubernetes" 2> /dev/null; then
  warn "Python kubernetes library not installed. Installing..."
  pip3 install kubernetes --user --break-system-packages 2> /dev/null \
    || pip3 install kubernetes --user 2> /dev/null \
    || error "Failed to install kubernetes library. Please install manually: pip3 install kubernetes"
fi

if [ "$DRY_RUN" = "true" ]; then
  log "DRY RUN MODE - Showing what would be executed:"
  echo ""
  echo "ansible-playbook $VERBOSE \\"
  echo "  -i localhost, \\"
  echo "  -e kubeconfig_path=${KUBECONFIG:-$HOME/.kube/config} \\"
  echo "  -e rhdh_ns=$NAMESPACE \\"
  echo "  -e deploy_keycloak=$ENABLE_KEYCLOAK \\"
  echo "  -e enable_gitops=$ENABLE_GITOPS \\"
  echo "  -e clean_install=$CLEAN \\"
  echo "  $SCRIPT_DIR/deploy.yml"
  echo ""
  exit 0
fi

# Clean namespace if requested
if [ "$CLEAN" = "true" ]; then
  log "Cleaning namespace $NAMESPACE..."
  
  # Delete all SonataFlow resources first (they can block namespace deletion)
  if oc get namespace "$NAMESPACE" > /dev/null 2>&1; then
    log "Deleting SonataFlow resources..."
    oc delete sonataflow --all -n "$NAMESPACE" --ignore-not-found --wait=false 2> /dev/null || true
    oc delete sonataflowplatform --all -n "$NAMESPACE" --ignore-not-found --wait=false 2> /dev/null || true
    sleep 5
  fi
  
  # Delete namespace
  oc delete namespace "$NAMESPACE" --ignore-not-found --wait=false 2> /dev/null || true

  # Wait for namespace deletion with better feedback
  log "Waiting for namespace deletion (this may take up to 1 minute)..."
  for i in {1..30}; do
    if ! oc get namespace "$NAMESPACE" > /dev/null 2>&1; then
      log "Namespace deleted successfully!"
      break
    fi
    if [ $((i % 5)) -eq 0 ]; then
      echo "  Still waiting... ($i/30)"
    else
      echo -n "."
    fi
    sleep 2
  done
  echo ""
  
  # Force cleanup of stuck resources if namespace still exists
  if oc get namespace "$NAMESPACE" > /dev/null 2>&1; then
    warn "Namespace still exists after 60s, attempting force cleanup..."
    oc delete pods --all -n "$NAMESPACE" --force --grace-period=0 2> /dev/null || true
    sleep 5
  fi
fi

# Run deployment
log "Starting Orchestrator Infrastructure deployment..."
log "Configuration:"
log "  Namespace: $NAMESPACE"
log "  Keycloak: $ENABLE_KEYCLOAK"
log "  GitOps: $ENABLE_GITOPS"
log "  Clean: $CLEAN"

cd "$SCRIPT_DIR"

# Export variables for Ansible
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

# Run Ansible playbook
ansible-playbook $VERBOSE \
  -i localhost, \
  -e kubeconfig_path="$KUBECONFIG" \
  -e ansible_python_interpreter="$(which python3)" \
  -e rhdh_ns="$NAMESPACE" \
  -e deploy_keycloak="$ENABLE_KEYCLOAK" \
  -e enable_gitops="$ENABLE_GITOPS" \
  -e clean_install="$CLEAN" \
  deploy.yml

RET=$?

if [ $RET -eq 0 ]; then
  echo ""
  log "✅ Orchestrator Infrastructure deployed successfully!"
  echo ""
  info "Quick checks:"
  echo "  oc get pods -n $NAMESPACE"
  echo "  oc get svc -n $NAMESPACE"
  echo ""
  info "Integration with RHDH/Backstage:"
  echo "  Configure your Backstage with:"
  echo "    dataIndexService:"
  echo "      url: http://sonataflow-platform-data-index-service.$NAMESPACE"
  echo ""
  info "Note: The Orchestrator plugin automatically appends /graphql to the URL"
  echo ""
  info "Alternative full URL (if needed):"
  echo "      url: http://sonataflow-platform-data-index-service.$NAMESPACE.svc.cluster.local:80"
  echo ""
else
  error "Deployment failed with code: $RET"
  error "Check the logs above for details"
  exit $RET
fi
