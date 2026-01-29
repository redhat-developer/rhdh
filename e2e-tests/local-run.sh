#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_IMAGE="quay.io/rhdh-community/rhdh-e2e-runner:main"
RUN_CONFIG_FILE="$SCRIPT_DIR/.local-test/run-config.env"

# Source logging library
# shellcheck source=../.ibm/pipelines/lib/log.sh
source "$SCRIPT_DIR/../.ibm/pipelines/lib/log.sh"

# ========== CLI Flags ==========
show_help() {
    cat << EOF
Usage: ./local-run.sh [OPTIONS]

Run RHDH e2e tests locally against a Kubernetes cluster (OCP, AKS, EKS, GKE).

Options:
  -j, --job JOB_NAME      Job name (e.g., pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm)
                          Platform is derived from job name (*ocp*, *aks*, *eks*, *gke*, *osd*)
  -r, --repo QUAY_REPO    Quay repository (e.g., rhdh/rhdh-hub-rhel9)
  -t, --tag TAG_NAME      Image tag (e.g., next, latest, 1.5)
  -p, --pr PR_NUMBER      PR number (sets repo to rhdh-community/rhdh, tag to pr-<number>)
  -s, --skip-tests        Deploy only, skip running tests
  -h, --help              Show this help message

Examples:
  # Interactive mode (default)
  ./local-run.sh

  # Deploy downstream next image on OCP, skip tests
  ./local-run.sh --repo rhdh/rhdh-hub-rhel9 --tag next --skip-tests

  # Test a PR image on OCP
  ./local-run.sh --pr 4023 --skip-tests

  # Run on AKS
  ./local-run.sh -j periodic-ci-aks-helm-nightly -r rhdh/rhdh-hub-rhel9 -t next -s

  # Run on EKS
  ./local-run.sh -j periodic-ci-eks-helm-nightly -r rhdh/rhdh-hub-rhel9 -t next -s

  # Run on GKE
  ./local-run.sh -j periodic-ci-gke-helm-nightly -r rhdh/rhdh-hub-rhel9 -t next -s

EOF
    exit 0
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -j|--job)
            CLI_JOB_NAME="$2"
            shift 2
            ;;
        -r|--repo)
            CLI_QUAY_REPO="$2"
            shift 2
            ;;
        -t|--tag)
            CLI_TAG_NAME="$2"
            shift 2
            ;;
        -p|--pr)
            CLI_QUAY_REPO="rhdh-community/rhdh"
            CLI_TAG_NAME="pr-$2"
            shift 2
            ;;
        -s|--skip-tests)
            CLI_SKIP_TESTS="true"
            shift
            ;;
        -h|--help)
            show_help
            ;;
        *)
            log::error "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# ========== Prerequisites Check ==========
PREREQ_FAILED=false
MISSING_CMDS=""

# Check required binaries (bc is used for memory comparison)
# Note: kubectl is needed for AKS/EKS, oc is needed for OCP
for cmd in podman oc kubectl vault jq curl rsync bc; do
    if ! command -v "$cmd" &> /dev/null; then
        MISSING_CMDS="$MISSING_CMDS $cmd"
        PREREQ_FAILED=true
    fi
done

# Check if podman machine is running
if command -v podman &> /dev/null; then
    PODMAN_RUNNING=$(podman machine list --format '{{.Name}} {{.Running}}' 2>/dev/null | grep -w "true" | head -1 || true)
    if [[ -z "$PODMAN_RUNNING" ]]; then
        log::error "No podman machine is running"
        log::info "  Run: podman machine start"
        PREREQ_FAILED=true
    else
        # Warn if memory or CPUs are low
        MACHINE_NAME=$(echo "$PODMAN_RUNNING" | awk '{print $1}')
        MACHINE_MEM=$(podman machine list --format '{{.Name}} {{.Memory}}' | grep "^${MACHINE_NAME}" | awk '{print $2}')
        MACHINE_CPUS=$(podman machine list --format '{{.Name}} {{.CPUs}}' | grep "^${MACHINE_NAME}" | awk '{print $2}')
        MEM_GB=$(echo "$MACHINE_MEM" | sed 's/GiB//' | sed 's/MiB//')
        if [[ "$MACHINE_MEM" == *"MiB"* ]] || [[ $(echo "$MEM_GB < 8" | bc -l) -eq 1 ]]; then
            log::warn "Podman machine '$MACHINE_NAME' has only $MACHINE_MEM RAM"
            log::info "  Recommend at least 8GB RAM and 4 CPUs for Playwright tests"
            log::info "  Run: podman machine stop $MACHINE_NAME && podman machine set $MACHINE_NAME --memory 8192 --cpus 4 && podman machine start $MACHINE_NAME"
        elif [[ "$MACHINE_CPUS" -lt 4 ]]; then
            log::warn "Podman machine '$MACHINE_NAME' has only $MACHINE_CPUS CPUs"
            log::info "  Recommend at least 8GB RAM and 4 CPUs for Playwright tests"
        fi
    fi
fi

# Note: Cluster login check happens after job selection (platform-specific)

if [[ -n "$MISSING_CMDS" ]]; then
    log::error "Missing required commands:$MISSING_CMDS"
    log::info "  Install missing tools:"
    log::info "    brew install podman jq rsync openshift-cli kubernetes-cli"
    log::info "    (bc is pre-installed on macOS, install via 'brew install bc' if missing)"
    log::info "    brew tap hashicorp/tap && brew install hashicorp/tap/vault"
fi

if [[ "$PREREQ_FAILED" == "true" ]]; then
    exit 1
fi

# ========== Interactive Configuration ==========
log::section "RHDH Local Test Runner"

# Check if CLI flags provide all required options (skip interactive mode)
CLI_MODE="false"
if [[ -n "$CLI_QUAY_REPO" && -n "$CLI_TAG_NAME" ]]; then
    CLI_MODE="true"
    JOB_NAME="${CLI_JOB_NAME:-pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm}"
    QUAY_REPO="$CLI_QUAY_REPO"
    TAG_NAME="$CLI_TAG_NAME"
    SKIP_TESTS="${CLI_SKIP_TESTS:-false}"
    log::info "Using CLI flags (non-interactive mode)"
    echo ""
fi

# Check for previous configuration (only if not in CLI mode)
USE_PREVIOUS="false"
if [[ "$CLI_MODE" == "false" && -f "$RUN_CONFIG_FILE" ]]; then
    echo "Previous configuration found:"
    echo "----------------------------------------"
    source "$RUN_CONFIG_FILE"
    echo "  JOB_NAME:   $JOB_NAME"
    echo "  IMAGE:      quay.io/${QUAY_REPO}:${TAG_NAME}"
    echo "  SKIP_TESTS: $SKIP_TESTS"
    echo "----------------------------------------"
    echo ""
    read -r -p "Use previous configuration? [Y/n]: " use_prev_choice
    use_prev_choice=${use_prev_choice:-Y}
    if [[ "$use_prev_choice" =~ ^[Yy]$ ]]; then
        USE_PREVIOUS="true"
        echo ""
    fi
fi

if [[ "$CLI_MODE" == "false" && "$USE_PREVIOUS" == "false" ]]; then
    # Run mode selection (Deploy only is default for local debugging)
    echo "What do you want to run?"
    echo "  1) Deploy only (recommended for local headed debugging)"
    echo "  2) Deploy and run tests (headless mode, runs all tests)"
    echo ""
    read -r -p "Enter choice [1]: " run_choice
    run_choice=${run_choice:-1}

    case "$run_choice" in
        1) SKIP_TESTS="true" ;;
        2) SKIP_TESTS="false" ;;
        *) SKIP_TESTS="true" ;;
    esac
    echo ""

    # Job selection
    echo "Select test job to run:"
    echo "  1) OCP Helm PR tests (pull-ci-*-ocp-helm)"
    echo "  2) OCP Helm Nightly tests (*ocp*helm*nightly*)"
    echo "  3) OCP Operator Nightly (*ocp*operator*nightly*)"
    echo "  4) OCP Helm Upgrade (*ocp*helm*upgrade*nightly*)"
    echo "  5) Auth Providers (*ocp*operator*auth-providers*nightly*)"
    echo "  6) AKS Helm Nightly (*aks*helm*nightly*)"
    echo "  7) EKS Helm Nightly (*eks*helm*nightly*)"
    echo "  8) GKE Helm Nightly (*gke*helm*nightly*)"
    echo "  9) Custom job name"
    echo ""
    read -r -p "Enter choice [1]: " job_choice
    job_choice=${job_choice:-1}

    case "$job_choice" in
        1) JOB_NAME="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm" ;;
        2) JOB_NAME="periodic-ci-ocp-helm-nightly" ;;
        3) JOB_NAME="periodic-ci-ocp-operator-nightly" ;;
        4) JOB_NAME="periodic-ci-ocp-helm-upgrade-nightly" ;;
        5) JOB_NAME="periodic-ci-ocp-operator-auth-providers-nightly" ;;
        6) JOB_NAME="periodic-ci-aks-helm-nightly" ;;
        7) JOB_NAME="periodic-ci-eks-helm-nightly" ;;
        8) JOB_NAME="periodic-ci-gke-helm-nightly" ;;
        9)
            read -r -p "Enter custom JOB_NAME: " JOB_NAME
            ;;
        *) JOB_NAME="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm" ;;
    esac
    echo "JOB_NAME: $JOB_NAME"
    echo ""

    # Image selection - Downstream vs PR
    echo "Select image type:"
    echo "  1) Downstream image (quay.io/rhdh/rhdh-hub-rhel9)"
    echo "  2) PR image (quay.io/rhdh-community/rhdh)"
    echo ""
    read -r -p "Enter choice [1]: " image_type_choice
    image_type_choice=${image_type_choice:-1}

    case "$image_type_choice" in
        1)
            # Downstream image
            QUAY_REPO="rhdh/rhdh-hub-rhel9"
            echo ""
            echo "Select image tag (quay.io/rhdh/rhdh-hub-rhel9):"
            echo "  1) next (latest development build)"
            echo "  2) latest (latest stable release)"
            echo "  3) Release-specific tag (e.g., 1.5, 1.4)"
            echo ""
            read -r -p "Enter choice [1]: " tag_choice
            tag_choice=${tag_choice:-1}

            case "$tag_choice" in
                1) TAG_NAME="next" ;;
                2) TAG_NAME="latest" ;;
                3)
                    read -r -p "Enter release tag (e.g., 1.5): " TAG_NAME
                    ;;
                *) TAG_NAME="next" ;;
            esac
            ;;
        2)
            # PR image
            QUAY_REPO="rhdh-community/rhdh"
            echo ""
            read -r -p "Enter PR number (quay.io/rhdh-community/rhdh:pr-<number>): " PR_NUMBER
            TAG_NAME="pr-${PR_NUMBER}"
            ;;
        *)
            QUAY_REPO="rhdh/rhdh-hub-rhel9"
            TAG_NAME="next"
            ;;
    esac
    echo ""
    echo "Image: quay.io/${QUAY_REPO}:${TAG_NAME}"
    echo ""

    # Save configuration for next run
    mkdir -p "$(dirname "$RUN_CONFIG_FILE")"
    cat > "$RUN_CONFIG_FILE" <<EOF
# Auto-generated by local-run.sh
# Generated at: $(date)
JOB_NAME="$JOB_NAME"
QUAY_REPO="$QUAY_REPO"
TAG_NAME="$TAG_NAME"
SKIP_TESTS="$SKIP_TESTS"
EOF
    echo "Configuration saved to: $RUN_CONFIG_FILE"
    echo ""
fi

# Verify image exists on quay.io
echo "Verifying image exists on quay.io..."
IMAGE_CHECK_RESPONSE=$(curl -s "https://quay.io/api/v1/repository/${QUAY_REPO}/tag/?specificTag=${TAG_NAME}")
TAG_COUNT=$(echo "$IMAGE_CHECK_RESPONSE" | jq '.tags | length')

if [[ "$TAG_COUNT" -eq 0 ]]; then
    log::error "Image quay.io/${QUAY_REPO}:${TAG_NAME} does not exist!"
    if [[ "$image_type_choice" == "2" ]]; then
        log::info "The PR image may not have been built yet."
        log::info "Check the PR build status or wait for the image to be pushed."
    fi
    exit 1
fi
log::success "Image verified: quay.io/${QUAY_REPO}:${TAG_NAME}"

# Derive CONTAINER_PLATFORM from JOB_NAME
if [[ "$JOB_NAME" == *"aks"* ]]; then
    CONTAINER_PLATFORM="aks"
elif [[ "$JOB_NAME" == *"eks"* ]]; then
    CONTAINER_PLATFORM="eks"
elif [[ "$JOB_NAME" == *"gke"* ]]; then
    CONTAINER_PLATFORM="gke"
elif [[ "$JOB_NAME" == *"osd"* ]]; then
    CONTAINER_PLATFORM="osd-gcp"
else
    CONTAINER_PLATFORM="ocp"
fi

log::section "Configuration Summary"
log::info "JOB_NAME:    $JOB_NAME"
log::info "PLATFORM:    $CONTAINER_PLATFORM"
log::info "IMAGE:       quay.io/${QUAY_REPO}:${TAG_NAME}"
log::info "SKIP_TESTS:  $SKIP_TESTS"
echo ""
if [[ "$CLI_MODE" == "false" ]]; then
    read -r -p "Press Enter to continue or Ctrl+C to abort..."
    echo ""
fi

# Pull runner image first (can take a while)
log::section "Pulling runner container image"
podman pull "$RUNNER_IMAGE" --platform=linux/amd64

export VAULT_ADDR='https://vault.ci.openshift.org'

# Login to vault and capture the token
log::section "Vault Login"
vault login -no-print -method=oidc
VAULT_TOKEN=$(vault print token)

# Set up cluster access based on platform (CONTAINER_PLATFORM already derived above)
log::section "Setting up cluster access"
log::info "CONTAINER_PLATFORM: $CONTAINER_PLATFORM"

SA_NAME="rhdh-local-tester"
SA_NAMESPACE="rhdh-local-test"
SA_SECRET_NAME="${SA_NAME}-secret"

# Check cluster connectivity and create service account token based on platform
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
    # OpenShift platforms - use oc commands
    if ! oc cluster-info &> /dev/null; then
        log::error "Not logged into OpenShift cluster"
        log::info "  Run: oc login <cluster-url>"
        exit 1
    fi
    K8S_CLUSTER_URL=$(oc whoami --show-server)
    oc create namespace "$SA_NAMESPACE" 2>/dev/null || log::info "Namespace already exists"
    oc create serviceaccount "$SA_NAME" -n "$SA_NAMESPACE" 2>/dev/null || log::info "Service account already exists"
    oc adm policy add-cluster-role-to-user cluster-admin "system:serviceaccount:${SA_NAMESPACE}:${SA_NAME}" 2>/dev/null || true
    K8S_CLUSTER_TOKEN=$(oc create token "$SA_NAME" -n "$SA_NAMESPACE" --duration=48h)
else
    # Non-OpenShift platforms (AKS, EKS, GKE) - use kubectl commands
    if ! kubectl cluster-info &> /dev/null; then
        log::error "Cannot connect to Kubernetes cluster"
        log::info "  Ensure your kubeconfig is set correctly"
        log::info "  Run: kubectl cluster-info"
        exit 1
    fi
    K8S_CLUSTER_URL=$(kubectl config view --minify -o jsonpath='{.clusters[0].cluster.server}')

    # Check if token already exists
    if token="$(kubectl get secret ${SA_SECRET_NAME} -n ${SA_NAMESPACE} -o jsonpath='{.data.token}' 2>/dev/null)"; then
        K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
        log::info "Using existing service account token"
    else
        # Create namespace and service account
        kubectl create namespace "$SA_NAMESPACE" 2>/dev/null || log::info "Namespace already exists"
        if ! kubectl get serviceaccount ${SA_NAME} -n ${SA_NAMESPACE} &> /dev/null; then
            log::info "Creating service account ${SA_NAME}..."
            kubectl create serviceaccount ${SA_NAME} -n ${SA_NAMESPACE}
            kubectl create clusterrolebinding ${SA_NAME}-binding \
                --clusterrole=cluster-admin \
                --serviceaccount=${SA_NAMESPACE}:${SA_NAME} 2>/dev/null || true
        fi

        # Create secret for service account token (non-OpenShift approach)
        log::info "Creating secret for service account token..."
        kubectl apply --namespace="${SA_NAMESPACE}" -f - <<EOF
apiVersion: v1
kind: Secret
metadata:
  name: ${SA_SECRET_NAME}
  namespace: ${SA_NAMESPACE}
  annotations:
    kubernetes.io/service-account.name: ${SA_NAME}
type: kubernetes.io/service-account-token
EOF

        # Wait for token to be populated
        log::info "Waiting for token to be populated..."
        for i in {1..12}; do
            if token="$(kubectl get secret ${SA_SECRET_NAME} -n ${SA_NAMESPACE} -o jsonpath='{.data.token}' 2>/dev/null)" && [[ -n "$token" ]]; then
                log::info "Token acquired on attempt $i"
                break
            elif [[ $i -eq 12 ]]; then
                log::error "Failed to get token after $i attempts"
                exit 1
            fi
            sleep 5
        done
        K8S_CLUSTER_TOKEN=$(echo "${token}" | base64 --decode)
    fi
fi
log::info "K8S_CLUSTER_URL: $K8S_CLUSTER_URL"

# Copy repo to work directory (keeps original repo clean)
log::section "Copying repo to work directory"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORK_DIR="$SCRIPT_DIR/.local-test/rhdh"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
rsync -a --exclude='node_modules' --exclude='.local-test' --exclude='playwright-report' --exclude='test-results' "$REPO_ROOT/" "$WORK_DIR/"
log::info "Work copy created at: $WORK_DIR"

# Run container with vault credentials and OC token
log::section "Starting Container (rhdh-e2e-runner)"
log::info "Running container (rhdh-e2e-runner)..."
log::info "This will deploy RHDH to your cluster and run tests (if enabled)."
echo ""

# Create log file for container output
CONTAINER_LOG="$SCRIPT_DIR/.local-test/container.log"
mkdir -p "$(dirname "$CONTAINER_LOG")"
log::info "Container log: $CONTAINER_LOG"
echo ""

CONTAINER_EXIT_CODE=0
podman run -v "$WORK_DIR":/tmp/rhdh \
    -v "$SCRIPT_DIR/container-init.sh":/tmp/container-init.sh:ro \
    -it -u root --privileged \
    --mount type=tmpfs,destination=/tmp/secrets \
    -e VAULT_ADDR="$VAULT_ADDR" \
    -e VAULT_TOKEN="$VAULT_TOKEN" \
    -e K8S_CLUSTER_URL="$K8S_CLUSTER_URL" \
    -e K8S_CLUSTER_TOKEN="$K8S_CLUSTER_TOKEN" \
    -e CONTAINER_PLATFORM="$CONTAINER_PLATFORM" \
    -e JOB_NAME="$JOB_NAME" \
    -e QUAY_REPO="$QUAY_REPO" \
    -e TAG_NAME="$TAG_NAME" \
    -e SKIP_TESTS="$SKIP_TESTS" \
    "$RUNNER_IMAGE" \
    /bin/bash /tmp/container-init.sh 2>&1 | tee "$CONTAINER_LOG"
CONTAINER_EXIT_CODE=${PIPESTATUS[0]}

# Container has exited - show next steps
echo ""
log::section "Container (rhdh-e2e-runner) Finished - Back on Host"
log::info "You are now back on your host machine."
if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
    log::info "You are still logged into the cluster via 'oc' CLI."
else
    log::info "You are still logged into the cluster via 'kubectl' CLI."
fi
echo ""

if [[ "$CONTAINER_EXIT_CODE" -ne 0 ]]; then
    log::error "Container (rhdh-e2e-runner) exited with error code: $CONTAINER_EXIT_CODE"
    echo ""
    log::info "Troubleshooting:"
    echo "   - Container log: $CONTAINER_LOG"
    echo "   - Pod logs: e2e-tests/.local-test/rhdh/.local-test/artifact_dir/"
    if [[ "$CONTAINER_PLATFORM" == "ocp" || "$CONTAINER_PLATFORM" == "osd-gcp" ]]; then
        echo "   - Check cluster pods: oc get pods -A"
        echo "   - Check pod logs: oc logs <pod-name> -n <namespace>"
    else
        echo "   - Check cluster pods: kubectl get pods -A"
        echo "   - Check pod logs: kubectl logs <pod-name> -n <namespace>"
    fi
    echo ""
    exit $CONTAINER_EXIT_CODE
fi

if [[ "$SKIP_TESTS" == "true" ]]; then
    log::section "Next Steps: Run Tests Locally (headed mode)"
    echo ""
    log::info "1. Setup environment variables:"
    echo "   source local-test-setup.sh           # For Showcase tests"
    echo "   source local-test-setup.sh rbac      # For RBAC tests"
    echo ""
    log::info "2. Install dependencies and run tests:"
    echo "   yarn install"
    echo "   yarn playwright test --headed"
    echo ""
    log::info "Useful Playwright commands:"
    echo ""
    echo "   # Run all tests for a project"
    echo "   yarn playwright test --headed --project=showcase"
    echo "   yarn playwright test --headed --project=showcase-rbac"
    echo ""
    echo "   # Run a specific test file (use --workers=1 for sequential execution)"
    echo "   yarn playwright test --headed --project=showcase-rbac --workers=1 playwright/e2e/plugins/rbac/rbac.spec.ts"
    echo "   yarn playwright test --headed --project=showcase --workers=1 playwright/e2e/plugins/quick-access-and-tech-radar.spec.ts"
    echo ""
    echo "   # Run tests matching a pattern"
    echo "   yarn playwright test --headed --project=showcase-rbac --workers=1 -g \"guest user\""
    echo "   yarn playwright test --headed --project=showcase --workers=1 -g \"catalog\""
    echo ""
    echo "   # Interactive UI mode"
    echo "   yarn playwright test --ui --project=showcase"
    echo "   yarn playwright test --ui --project=showcase-rbac"
    echo ""
else
    log::section "Tests Completed"
    log::info "Test artifacts saved to: e2e-tests/.local-test/rhdh/.local-test/artifact_dir/"
    echo ""
    log::info "To view test reports:"
    echo "   npx playwright show-report .local-test/rhdh/.local-test/artifact_dir/showcase"
    echo ""
    log::info "To re-run tests locally (headed mode):"
    echo "   source local-test-setup.sh"
    echo "   yarn playwright test --headed"
    echo ""
fi