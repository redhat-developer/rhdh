# ============================================================================
# RHDH CI/CD Scripts - Makefile
# ============================================================================
# Simplifies common operations for the refactored CI/CD scripts
#
# Usage:
#   make deploy           - Deploy base RHDH
#   make deploy-rbac      - Deploy RHDH with RBAC
#   make test             - Run tests
#   make cleanup          - Clean up all resources
#   make pull             - Run pull request validation
#   make nightly          - Run nightly tests
#   make operator         - Deploy using operator
#   make help             - Show this help
#

.PHONY: help deploy deploy-rbac test cleanup pull nightly operator validate-env check-tools auth-providers lint-ci test-bats docs diagram info

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# VARIABLES
# ============================================================================

SCRIPT_DIR := $(shell pwd)
OPENSHIFT_CI ?= false
NAMESPACE ?= showcase
NAMESPACE_RBAC ?= showcase-rbac

# Export environment for scripts
export OPENSHIFT_CI
export NAME_SPACE=$(NAMESPACE)
export NAME_SPACE_RBAC=$(NAMESPACE_RBAC)

# ============================================================================
# HELP
# ============================================================================

help: ## Show this help message
	@echo "╔════════════════════════════════════════════════════════════════╗"
	@echo "║         RHDH CI/CD Scripts - Refactored Version              ║"
	@echo "╚════════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Usage: make [target] [VARIABLE=value]"
	@echo ""
	@echo "Available targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Variables:"
	@echo "  NAMESPACE             Base namespace (default: showcase)"
	@echo "  NAMESPACE_RBAC        RBAC namespace (default: showcase-rbac)"
	@echo "  DEBUG                 Enable debug mode (true/false)"
	@echo "  OPENSHIFT_CI          CI environment flag (default: false)"
	@echo "  DEPLOY_ORCHESTRATOR   Enable SonataFlow Orchestrator (default: false)"
	@echo "                        Note: Only enabled by default in nightly jobs"
	@echo ""
	@echo "Cloud Variables:"
	@echo "  AKS_CLUSTER_NAME      Azure AKS cluster name"
	@echo "  AKS_RESOURCE_GROUP    Azure resource group"
	@echo "  GKE_CLUSTER_NAME      Google GKE cluster name"
	@echo "  GKE_CLUSTER_REGION    Google GKE region"
	@echo "  GCP_PROJECT           Google Cloud project"
	@echo "  KUBECONFIG            Path to kubeconfig (required for EKS)"
	@echo ""
	@echo "Examples:"
	@echo "  make deploy                                 # Standard (no orchestrator)"
	@echo "  make deploy-rbac                            # Standard (no orchestrator)"
	@echo "  make deploy DEPLOY_ORCHESTRATOR=true        # With orchestrator (infra + plugins)"
	@echo "  make deploy-rbac DEPLOY_ORCHESTRATOR=true   # With orchestrator (infra + plugins)"
	@echo "  make nightly                                # Nightly (orchestrator always enabled)"
	@echo "  make test DEBUG=true"
	@echo "  make cleanup"
	@echo ""
	@echo "Cloud Examples:"
	@echo "  make deploy-aks AKS_CLUSTER_NAME=my-cluster AKS_RESOURCE_GROUP=my-rg"
	@echo "  make deploy-eks KUBECONFIG=/path/to/kubeconfig"
	@echo "  make deploy-gke GKE_CLUSTER_NAME=my-cluster GKE_CLUSTER_REGION=us-central1 GCP_PROJECT=my-project"
	@echo "  make deploy-cloud                           # Auto-detect cloud provider"
	@echo "  make upgrade-test                           # Test upgrade from previous release"
	@echo ""

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

check-tools: ## Check if required tools are installed
	@echo "🔍 Checking required tools..."
	@command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl not found"; exit 1; }
	@command -v helm >/dev/null 2>&1 || { echo "❌ helm not found"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "❌ jq not found"; exit 1; }
	@command -v git >/dev/null 2>&1 || { echo "❌ git not found"; exit 1; }
	@command -v curl >/dev/null 2>&1 || { echo "❌ curl not found"; exit 1; }
	@echo "✅ All required tools are available"

validate-env: check-tools ## Validate environment configuration
	@echo "🔍 Validating environment..."
	@if [ ! -f "env_override.local.sh" ] && [ "$(OPENSHIFT_CI)" = "false" ]; then \
		echo "⚠️  Warning: env_override.local.sh not found"; \
		echo "   For local testing, copy env_override.local.sh.example"; \
	fi
	@if [ -f "env_override.local.sh" ]; then \
		echo "✅ Local environment override file found"; \
	fi
	@echo "✅ Environment validation complete"

# ============================================================================
# DEPLOYMENT TARGETS
# ============================================================================

deploy: validate-env ## Deploy base RHDH to OpenShift
	@echo "🚀 Deploying base RHDH..."
	JOB_NAME=deploy ./openshift-ci-tests.sh

deploy-debug: validate-env ## Deploy base RHDH with debug logging
	@echo "🚀 Deploying base RHDH (DEBUG MODE)..."
	DEBUG=true RHDH_LOG_LEVEL=debug JOB_NAME=deploy ./openshift-ci-tests.sh

deploy-rbac: validate-env ## Deploy RHDH with RBAC and PostgreSQL
	@echo "🚀 Deploying RHDH with RBAC..."
	JOB_NAME=deploy-rbac ./openshift-ci-tests.sh

deploy-rbac-debug: validate-env ## Deploy RHDH with RBAC and debug logging
	@echo "🚀 Deploying RHDH with RBAC (DEBUG MODE)..."
	DEBUG=true RHDH_LOG_LEVEL=debug JOB_NAME=deploy-rbac ./openshift-ci-tests.sh

operator: validate-env ## Deploy RHDH using operator
	@echo "🚀 Deploying RHDH using operator..."
	JOB_NAME=operator ./openshift-ci-tests.sh

# ============================================================================
# TEST TARGETS
# ============================================================================

test: validate-env ## Run tests on deployed instance
	@echo "🧪 Running tests..."
	JOB_NAME=test ./openshift-ci-tests.sh

pull: validate-env ## Run pull request validation (base + RBAC + tests)
	@echo "🔄 Running pull request validation..."
	JOB_NAME=pull ./openshift-ci-tests.sh

nightly: validate-env ## Run comprehensive nightly tests (with Orchestrator)
	@echo "🌙 Running nightly tests..."
	@echo "Note: Orchestrator will be deployed automatically for comprehensive testing"
	JOB_NAME=nightly ./openshift-ci-tests.sh
auth-providers: validate-env ## Run authentication providers job (OIDC, Microsoft, GitHub)
	@echo "🔐 Running auth-providers job..."
	JOB_NAME=auth-providers ./openshift-ci-tests.sh


# ============================================================================
# CLEANUP TARGETS
# ============================================================================

cleanup: ## Clean up all RHDH resources
	@echo "🧹 Cleaning up all resources..."
	JOB_NAME=cleanup ./openshift-ci-tests.sh

cleanup-force: ## Force cleanup including stuck resources
	@echo "🧹 Force cleaning up all resources..."
	FORCE_CLEANUP=true JOB_NAME=cleanup ./openshift-ci-tests.sh

cleanup-fast: ## Fast cleanup (aggressive, may leave some resources)
	@echo "⚡ Fast cleaning up all resources..."
	FAST_CLEANUP=true JOB_NAME=cleanup ./openshift-ci-tests.sh

# ============================================================================
# UTILITY TARGETS
# ============================================================================

logs: ## Collect deployment logs
lint-ci: ## Run shellcheck and fail on errors (CI mode)
	@echo "🔍 Running shellcheck (CI) ..."
	@shopt -s globstar; \
	files=(**/*.sh); \
	if command -v shellcheck >/dev/null 2>&1; then \
		shellcheck -x "${files[@]}"; \
	else \
		echo "⚠️  shellcheck not installed"; exit 1; \
	fi

test-bats: ## Run bats unit tests (if available)
	@echo "🧪 Running bats unit tests..."
	@if command -v bats >/dev/null 2>&1 && [ -d "tests/bats" ]; then \
		bats tests/bats; \
	else \
		echo "⚠️  bats not installed or tests/bats missing"; \
	fi
	@echo "📋 Collecting deployment logs..."
	@mkdir -p $(SCRIPT_DIR)/logs
	@kubectl get pods -n $(NAMESPACE) -o wide > $(SCRIPT_DIR)/logs/pods-$(NAMESPACE).txt 2>&1 || true
	@kubectl get events -n $(NAMESPACE) --sort-by='.lastTimestamp' > $(SCRIPT_DIR)/logs/events-$(NAMESPACE).txt 2>&1 || true
	@echo "✅ Logs saved to $(SCRIPT_DIR)/logs/"

status: ## Show deployment status
	@echo "📊 Deployment Status"
	@echo "===================="
	@echo ""
	@echo "Base Namespace ($(NAMESPACE)):"
	@kubectl get pods,svc,route -n $(NAMESPACE) 2>&1 | grep -E "^NAME|developer-hub" || echo "  No resources found"
	@echo ""
	@echo "RBAC Namespace ($(NAMESPACE_RBAC)):"
	@kubectl get pods,svc,route -n $(NAMESPACE_RBAC) 2>&1 | grep -E "^NAME|developer-hub" || echo "  No resources found"

url: ## Show RHDH URLs
	@echo "🔗 RHDH URLs"
	@echo "============"
	@if kubectl get route redhat-developer-hub -n $(NAMESPACE) &>/dev/null; then \
		echo "Base:  https://$$(kubectl get route redhat-developer-hub -n $(NAMESPACE) -o jsonpath='{.spec.host}')"; \
	else \
		echo "Base:  Not deployed"; \
	fi
	@if kubectl get route redhat-developer-hub -n $(NAMESPACE_RBAC) &>/dev/null; then \
		echo "RBAC:  https://$$(kubectl get route redhat-developer-hub -n $(NAMESPACE_RBAC) -o jsonpath='{.spec.host}')"; \
	else \
		echo "RBAC:  Not deployed"; \
	fi

health: ## Check health of deployed instances
	@echo "💚 Health Check"
	@echo "==============="
	@if kubectl get route redhat-developer-hub -n $(NAMESPACE) &>/dev/null; then \
		URL=$$(kubectl get route redhat-developer-hub -n $(NAMESPACE) -o jsonpath='{.spec.host}'); \
		echo -n "Base:  "; \
		curl -s -o /dev/null -w "HTTP %{http_code}" "https://$${URL}/api/health" || echo "Failed to connect"; \
		echo ""; \
	fi
	@if kubectl get route redhat-developer-hub -n $(NAMESPACE_RBAC) &>/dev/null; then \
		URL=$$(kubectl get route redhat-developer-hub -n $(NAMESPACE_RBAC) -o jsonpath='{.spec.host}'); \
		echo -n "RBAC:  "; \
		curl -s -o /dev/null -w "HTTP %{http_code}" "https://$${URL}/api/health" || echo "Failed to connect"; \
		echo ""; \
	fi

# ============================================================================
# DEVELOPMENT TARGETS
# ============================================================================

shell: ## Open interactive shell with environment loaded
	@echo "🐚 Opening shell with environment loaded..."
	@bash --init-file <(echo '. $(HOME)/.bashrc 2>/dev/null || true; source env_variables.sh; echo "Environment loaded. Type exit to return."')

lint: ## Run shellcheck on all scripts
	@echo "🔍 Running shellcheck..."
	@find . -name "*.sh" -type f ! -path "*/node_modules/*" ! -path "*/serverless-workflows/*" -exec shellcheck -x {} + || true

format: ## Format shell scripts with shfmt
	@echo "💅 Formatting scripts..."
	@if command -v shfmt &>/dev/null; then \
		find . -name "*.sh" -type f ! -path "*/node_modules/*" ! -path "*/serverless-workflows/*" -exec shfmt -w -i 4 -ci {} +; \
		echo "✅ Formatting complete"; \
	else \
		echo "⚠️  shfmt not installed. Install with: brew install shfmt"; \
	fi

# ============================================================================
# CLOUD DEPLOYMENT TARGETS
# ============================================================================

deploy-aks: validate-env ## Deploy RHDH to Azure Kubernetes Service
	@echo "☁️  Deploying to AKS..."
	@if [ -z "$(AKS_CLUSTER_NAME)" ] || [ -z "$(AKS_RESOURCE_GROUP)" ]; then \
		echo "❌ Error: AKS_CLUSTER_NAME and AKS_RESOURCE_GROUP must be set"; \
		exit 1; \
	fi
	./jobs/aks-helm.sh

deploy-eks: validate-env ## Deploy RHDH to Amazon EKS
	@echo "☁️  Deploying to EKS..."
	@if [ -z "$(KUBECONFIG)" ]; then \
		echo "❌ Error: KUBECONFIG must be set for EKS deployment"; \
		exit 1; \
	fi
	./jobs/eks-helm.sh

deploy-gke: validate-env ## Deploy RHDH to Google Kubernetes Engine
	@echo "☁️  Deploying to GKE..."
	@if [ -z "$(GKE_CLUSTER_NAME)" ] || [ -z "$(GKE_CLUSTER_REGION)" ] || [ -z "$(GCP_PROJECT)" ]; then \
		echo "❌ Error: GKE_CLUSTER_NAME, GKE_CLUSTER_REGION, and GCP_PROJECT must be set"; \
		exit 1; \
	fi
	./jobs/gke-helm.sh

deploy-cloud: ## Deploy to cloud provider (auto-detect)
	@echo "☁️  Deploying to cloud (auto-detect)..."
	@CLOUD_PROVIDER=$$(./modules/cloud/bootstrap.sh detect); \
	case "$$CLOUD_PROVIDER" in \
		aks) $(MAKE) deploy-aks ;; \
		eks) $(MAKE) deploy-eks ;; \
		gke) $(MAKE) deploy-gke ;; \
		*) echo "❌ Could not detect cloud provider"; exit 1 ;; \
	esac

upgrade-test: validate-env ## Test upgrade from previous release
	@echo "⬆️  Running upgrade test..."
	./jobs/upgrade.sh

# ============================================================================
# CI/CD TARGETS
# ============================================================================

ci-deploy: export OPENSHIFT_CI=true
ci-deploy: deploy ## Deploy in CI mode

ci-test: export OPENSHIFT_CI=true
ci-test: test ## Test in CI mode

ci-cleanup: export OPENSHIFT_CI=true
ci-cleanup: cleanup ## Cleanup in CI mode

# ============================================================================
# DOCUMENTATION TARGETS
# ============================================================================

docs: ## Generate documentation
	@echo "📚 Documentation available in:"
	@echo "  - README.md (user guide)"
	@echo "  - docs/architecture.md (diagrams and overview)"
	@echo "  - docs/development-guide.md (development patterns)"
	@echo "  - .cursorrules (AI code generation rules)"

diagram: ## Generate architecture diagram
	@echo "📊 Architecture diagrams available in documentation"
	@echo "See: docs/architecture.md"

# ============================================================================
# QUALITY TARGETS
# ============================================================================

# ============================================================================
# COMBINED WORKFLOWS
# ============================================================================

full-deploy: cleanup deploy test ## Complete workflow: cleanup → deploy → test
	@echo "✅ Full deployment workflow completed"

full-deploy-rbac: cleanup deploy-rbac ## Complete workflow: cleanup → deploy RBAC
	@echo "✅ Full RBAC deployment workflow completed"

redeploy: cleanup-force deploy ## Force cleanup and redeploy
	@echo "✅ Redeployment completed"

# ============================================================================
# INFO
# ============================================================================

info: ## Show environment information
	@echo "📋 Environment Information"
	@echo "========================="
	@echo "Script Directory: $(SCRIPT_DIR)"
	@echo "Namespace:        $(NAMESPACE)"
	@echo "RBAC Namespace:   $(NAMESPACE_RBAC)"
	@echo "OpenShift CI:     $(OPENSHIFT_CI)"

