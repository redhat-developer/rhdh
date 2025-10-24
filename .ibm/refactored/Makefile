# ============================================================================
# RHDH CI/CD Scripts - Refactored Makefile
# ============================================================================
# Direct entry points - no JOB_NAME dependency
#
# Usage:
#   make deploy           - Deploy base RHDH
#   make deploy-rbac      - Deploy RHDH with RBAC
#   make test             - Run tests
#   make cleanup          - Clean up all resources
#   make help             - Show this help
#

.PHONY: help deploy deploy-rbac test cleanup pull nightly operator auth-providers
.PHONY: deploy-aks deploy-eks deploy-gke deploy-osd-gcp deploy-osd-gcp-operator validate-env check-tools
# Aliases (descriptive targets)
.PHONY: ocp-helm ocp-helm-nightly ocp-helm-upgrade-nightly ocp-helm-sealights-nightly
.PHONY: ocp-operator-nightly ocp-operator-auth-nightly
.PHONY: aks-helm-nightly aks-operator-nightly eks-helm-nightly eks-operator-nightly gke-helm-nightly gke-operator-nightly
.PHONY: osd-gcp-helm-nightly osd-gcp-operator-nightly
.PHONY: cleanup-aks-refactored cleanup-eks-refactored

# Default target
.DEFAULT_GOAL := help

# ============================================================================
# VARIABLES
# ============================================================================

SCRIPT_DIR := $(shell pwd)
ENTRYPOINTS_DIR := $(SCRIPT_DIR)/entrypoints
NAMESPACE ?= showcase
NAMESPACE_RBAC ?= showcase-rbac

# Export environment for scripts
export NAME_SPACE=$(NAMESPACE)
export NAME_SPACE_RBAC=$(NAMESPACE_RBAC)

# ============================================================================
# HELP
# ============================================================================

help: ## Show this help message
	@echo "╔════════════════════════════════════════════════════════════════╗"
	@echo "║              RHDH CI/CD - Refactored Version                  ║"
	@echo "╚════════════════════════════════════════════════════════════════╝"
	@echo ""
	@echo "Usage: make [target] [VARIABLE=value]"
	@echo ""
	@echo "Core targets:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Variables:"
	@echo "  NAMESPACE             Base namespace (default: showcase)"
	@echo "  NAMESPACE_RBAC        RBAC namespace (default: showcase-rbac)"
	@echo "  DEBUG                 Enable debug mode (true/false)"
	@echo "  DEPLOY_ORCHESTRATOR   Enable SonataFlow Orchestrator (default: false)"
	@echo ""

# ============================================================================
# PRE-FLIGHT CHECKS
# ============================================================================

check-tools: ## Check if required tools are installed
	@echo "🔍 Checking required tools..."
	@command -v kubectl >/dev/null 2>&1 || { echo "❌ kubectl not found"; exit 1; }
	@command -v helm >/dev/null 2>&1 || { echo "❌ helm not found"; exit 1; }
	@command -v jq >/dev/null 2>&1 || { echo "❌ jq not found"; exit 1; }
	@echo "✅ All required tools are available"

validate-env: check-tools ## Validate environment configuration
	@echo "🔍 Validating environment..."
	@if [ ! -f "env_override.local.sh" ] && [ -z "$$OPENSHIFT_CI" ]; then \
		echo "⚠️  Warning: env_override.local.sh not found"; \
		echo "   For local testing, copy env_override.local.sh.example"; \
	fi
	@echo "✅ Environment validation complete"

# ============================================================================
# DEPLOYMENT TARGETS - Direct entry points, no JOB_NAME
# ============================================================================

deploy: validate-env ## Deploy base RHDH
	@echo "🚀 Deploying base RHDH..."
	@bash $(ENTRYPOINTS_DIR)/deploy.sh

deploy-rbac: validate-env ## Deploy RHDH with RBAC
	@echo "🚀 Deploying RHDH with RBAC..."
	@bash $(ENTRYPOINTS_DIR)/deploy-rbac.sh

pull: validate-env ## Run pull request validation
	@echo "🔄 Running pull request validation..."
	@bash $(ENTRYPOINTS_DIR)/pull.sh

nightly: validate-env ## Run nightly tests (with Orchestrator)
	@echo "🌙 Running nightly tests..."
	@bash $(ENTRYPOINTS_DIR)/nightly.sh

cleanup: ## Clean up all RHDH resources
	@echo "🧹 Cleaning up all resources..."
	@bash $(ENTRYPOINTS_DIR)/cleanup.sh

# ============================================================================
# OPERATOR TARGETS
# ============================================================================

operator: validate-env ## Deploy using operator
	@echo "🚀 Deploying RHDH using operator..."
	@bash $(ENTRYPOINTS_DIR)/operator.sh

# ============================================================================
# UPGRADE TEST
# ============================================================================

upgrade: validate-env ## Test upgrade from previous version
	@echo "⬆️  Testing upgrade from previous version..."
	@bash $(ENTRYPOINTS_DIR)/upgrade.sh

# ============================================================================
# AUTH PROVIDERS
# ============================================================================

auth-providers: validate-env ## Test authentication providers
	@echo "🔐 Testing authentication providers..."
	@bash $(ENTRYPOINTS_DIR)/auth-providers.sh

# ============================================================================
# ALIASES - DESCRIPTIVE TARGETS (backwards compatible)
# ============================================================================

# OCP - Helm
ocp-helm:            ## [CI: e2e-ocp-helm]
	$(MAKE) pull

ocp-helm-nightly:    ## [CI: e2e-ocp-helm-nightly]
	$(MAKE) nightly

ocp-helm-upgrade-nightly: ## [CI: e2e-ocp-helm-upgrade-nightly]
	$(MAKE) upgrade

ocp-helm-sealights-nightly: ## [CI: e2e-ocp-helm-sealights-nightly]
	$(MAKE) nightly

# OCP - Operator
ocp-operator-nightly:       ## [CI: e2e-ocp-operator-nightly]
	$(MAKE) operator

ocp-operator-auth-nightly:  ## [CI: e2e-ocp-operator-auth-providers-nightly]
	$(MAKE) auth-providers

# Cloud - AKS/EKS/GKE
aks-helm-nightly:       ## [CI: e2e-aks-helm-nightly]
	$(MAKE) deploy-aks

aks-operator-nightly:   ## [CI: e2e-aks-operator-nightly]
	$(MAKE) deploy-aks && $(MAKE) operator

eks-helm-nightly:       ## [CI: e2e-eks-helm-nightly]
	$(MAKE) deploy-eks

eks-operator-nightly:   ## [CI: e2e-eks-operator-nightly]
	$(MAKE) deploy-eks && $(MAKE) operator

gke-helm-nightly:       ## [CI: e2e-gke-helm-nightly]
	$(MAKE) deploy-gke

gke-operator-nightly:   ## [CI: e2e-gke-operator-nightly]
	$(MAKE) deploy-gke && $(MAKE) operator

# OSD-GCP
osd-gcp-helm-nightly:       ## [CI: e2e-osd-gcp-helm-nightly]
	$(MAKE) deploy-osd-gcp && $(MAKE) test

osd-gcp-operator-nightly:   ## [CI: e2e-osd-gcp-operator-nightly]
	$(MAKE) deploy-osd-gcp-operator

# Cleanup
cleanup-aks-refactored:   ## [CI: cleanup-aks-refactored]
	$(MAKE) cleanup

cleanup-eks-refactored:   ## [CI: cleanup-eks-refactored]
	$(MAKE) cleanup

# ============================================================================
# CLOUD DEPLOYMENTS
# ============================================================================

deploy-aks: validate-env ## Deploy to Azure AKS
	@echo "☁️  Deploying to AKS..."
	@bash $(ENTRYPOINTS_DIR)/deploy-aks.sh

deploy-eks: validate-env ## Deploy to Amazon EKS
	@echo "☁️  Deploying to EKS..."
	@bash $(ENTRYPOINTS_DIR)/deploy-eks.sh

deploy-gke: validate-env ## Deploy to Google GKE
	@echo "☁️  Deploying to GKE..."
	@bash $(ENTRYPOINTS_DIR)/deploy-gke.sh

# ============================================================================
# OSD DEPLOYMENTS (OpenShift Dedicated on GCP)
# ============================================================================

deploy-osd-gcp: validate-env ## Deploy to OpenShift Dedicated on GCP (Helm)
	@echo "☁️  Deploying to OpenShift Dedicated on GCP..."
	@bash $(ENTRYPOINTS_DIR)/deploy-osd-gcp.sh

deploy-osd-gcp-operator: validate-env ## Deploy to OSD-GCP using operator
	@echo "☁️  Deploying to OSD-GCP with operator..."
	@bash $(ENTRYPOINTS_DIR)/deploy-osd-gcp-operator.sh

# ============================================================================
# TESTING
# ============================================================================

test: ## Run tests on deployed instance
	@echo "🧪 Running tests..."
	@bash $(ENTRYPOINTS_DIR)/test.sh

test-e2e: ## Run E2E tests with Playwright
	@echo "🎭 Running E2E tests..."
	@cd ../e2e-tests && yarn test

# ============================================================================
# UTILITIES
# ============================================================================

logs: ## Collect deployment logs
	@echo "📋 Collecting deployment logs..."
	@mkdir -p logs
	@kubectl get pods -n $(NAMESPACE) -o wide > logs/pods-$(NAMESPACE).txt 2>&1 || true
	@kubectl get events -n $(NAMESPACE) --sort-by='.lastTimestamp' > logs/events-$(NAMESPACE).txt 2>&1 || true
	@echo "✅ Logs saved to logs/"

status: ## Show deployment status
	@echo "📊 Deployment Status"
	@echo "===================="
	@kubectl get pods,svc,route -n $(NAMESPACE) 2>&1 | grep -E "^NAME|developer-hub" || echo "No resources found"

url: ## Show RHDH URLs
	@echo "🔗 RHDH URLs"
	@echo "============"
	@kubectl get route -A | grep developer-hub || echo "No routes found"

# ============================================================================
# DEVELOPMENT
# ============================================================================

shell: ## Open interactive shell with environment loaded
	@echo "🐚 Opening shell with environment loaded..."
	@bash --init-file <(echo '. env_variables.sh 2>/dev/null || true; echo "Environment loaded"')

format: ## Format shell scripts with shfmt
	@echo "💅 Formatting scripts..."
	@if command -v shfmt &>/dev/null; then \
		find . -name "*.sh" -type f -exec shfmt -w -i 2 -ci {} +; \
		echo "✅ Formatting complete"; \
	else \
		echo "⚠️  shfmt not installed. Install with: brew install shfmt"; \
	fi

# Note: Linting is handled by yarn/npm in package.json
# Run: yarn lint or npm run lint for JavaScript/TypeScript
# ShellCheck is integrated with CI and can be run via: shellcheck **/*.sh

# ============================================================================
# CI/CD
# ============================================================================

ci-deploy: export OPENSHIFT_CI=true
ci-deploy: deploy ## Deploy in CI mode

ci-test: export OPENSHIFT_CI=true
ci-test: test ## Test in CI mode

ci-cleanup: export OPENSHIFT_CI=true
ci-cleanup: cleanup ## Cleanup in CI mode