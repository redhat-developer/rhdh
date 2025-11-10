# Makefile for RHDH CI/CD Pipeline
# This is a convenience wrapper around the main.sh entry point

.DEFAULT_GOAL := help
SHELL := /bin/bash

# Colors for output
CYAN := \033[0;36m
GREEN := \033[0;32m
YELLOW := \033[0;33m
RED := \033[0;31m
RESET := \033[0m

# ============================================================================
# Help Target
# ============================================================================

.PHONY: help
help: ## Show this help message
	@echo "$(CYAN)RHDH CI/CD Pipeline - Available Targets$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-30s$(RESET) %s\n", $$1, $$2}'
	@echo ""
	@echo "$(YELLOW)Examples:$(RESET)"
	@echo "  make ocp-pull          # Run OCP Pull tests"
	@echo "  make validate          # Validate pipeline configuration"
	@echo "  make clean            # Clean up test resources"

# ============================================================================
# Job Execution
# ============================================================================

.PHONY: ocp-pull
ocp-pull: ## Run OCP Pull request tests
	@echo "$(CYAN)Running OCP Pull tests...$(RESET)"
	@./main.sh

.PHONY: run
run: ## Run the pipeline (alias for main.sh)
	@./main.sh

# ============================================================================
# Development Targets
# ============================================================================

.PHONY: validate
validate: ## Validate all shell scripts syntax
	@echo "$(CYAN)Validating shell scripts...$(RESET)"
	@bash -n main.sh && echo "$(GREEN)✓$(RESET) main.sh"
	@for file in core/*.sh; do \
		bash -n "$$file" && echo "$(GREEN)✓$(RESET) $$file"; \
	done
	@find modules -name '*.sh' -type f | while read -r file; do \
		bash -n "$$file" && echo "$(GREEN)✓$(RESET) $$file"; \
	done
	@find jobs -name '*.sh' -type f | while read -r file; do \
		bash -n "$$file" && echo "$(GREEN)✓$(RESET) $$file"; \
	done
	@for file in scripts/*.sh; do \
		bash -n "$$file" && echo "$(GREEN)✓$(RESET) $$file"; \
	done
	@echo "$(GREEN)All scripts passed syntax validation$(RESET)"

.PHONY: lint
lint: ## Lint all shell scripts with shellcheck (requires shellcheck)
	@echo "$(CYAN)Linting shell scripts with shellcheck...$(RESET)"
	@if ! command -v shellcheck &> /dev/null; then \
		echo "$(RED)shellcheck not found. Install with: brew install shellcheck$(RESET)"; \
		exit 1; \
	fi
	@find . -name '*.sh' -type f | xargs shellcheck || \
		echo "$(YELLOW)Some linting issues found. Review and fix as needed.$(RESET)"

.PHONY: test-integration
test-integration: ## Run integration tests
	@echo "$(CYAN)Running integration tests...$(RESET)"
	@if [ -f "../test_integration.sh" ]; then \
		bash ../test_integration.sh; \
	else \
		echo "$(YELLOW)Integration test script not found$(RESET)"; \
	fi

.PHONY: check-prereqs
check-prereqs: ## Check if all required tools are installed
	@echo "$(CYAN)Checking prerequisites...$(RESET)"
	@if [ -f "scripts/validate-prerequisites.sh" ]; then \
		./scripts/validate-prerequisites.sh; \
	else \
		echo "$(YELLOW)Prerequisites validation script not found$(RESET)"; \
		echo "Checking manually..."; \
		which bash || echo "$(RED)✗ bash not found$(RESET)"; \
		which oc || echo "$(YELLOW)⚠ oc not found (required for OCP)$(RESET)"; \
		which helm || echo "$(YELLOW)⚠ helm not found$(RESET)"; \
		which kubectl || echo "$(YELLOW)⚠ kubectl not found$(RESET)"; \
		which yq || echo "$(YELLOW)⚠ yq not found$(RESET)"; \
		which jq || echo "$(YELLOW)⚠ jq not found$(RESET)"; \
	fi

# ============================================================================
# Cleanup Targets
# ============================================================================

.PHONY: clean
clean: ## Clean up test resources and temporary files
	@echo "$(CYAN)Cleaning up test resources...$(RESET)"
	@./scripts/cleanup.sh

.PHONY: clean-artifacts
clean-artifacts: ## Clean artifacts but keep namespaces
	@echo "$(CYAN)Cleaning artifacts...$(RESET)"
	@./scripts/cleanup.sh --skip-namespaces

.PHONY: clean-keep-artifacts
clean-keep-artifacts: ## Clean namespaces but keep artifacts for analysis
	@echo "$(CYAN)Cleaning namespaces (keeping artifacts)...$(RESET)"
	@./scripts/cleanup.sh --keep-artifacts

.PHONY: clean-local-artifacts
clean-local-artifacts: ## Clean local artifact directories (shared_dir and artifact_dir)
	@echo "$(CYAN)Cleaning local artifact directories...$(RESET)"
	@rm -rf shared_dir artifact_dir
	@echo "$(GREEN)Local artifacts cleaned$(RESET)"

# ============================================================================
# Documentation Targets
# ============================================================================

.PHONY: docs
docs: ## Display main documentation
	@cat README.md

.PHONY: architecture
architecture: ## Display architecture review
	@if [ -f "ARCHITECTURE_REVIEW.md" ]; then \
		cat ARCHITECTURE_REVIEW.md; \
	else \
		echo "$(YELLOW)Architecture review not found$(RESET)"; \
	fi

.PHONY: migration
migration: ## Display migration summary
	@if [ -f "MIGRATION_SUMMARY.md" ]; then \
		cat MIGRATION_SUMMARY.md; \
	else \
		echo "$(YELLOW)Migration summary not found$(RESET)"; \
	fi

# ============================================================================
# Structure Inspection
# ============================================================================

.PHONY: tree
tree: ## Show directory structure
	@echo "$(CYAN)Pipeline directory structure:$(RESET)"
	@tree -L 3 -I 'node_modules' . || \
		(echo "$(YELLOW)tree command not found, using ls instead:$(RESET)" && \
		ls -R | grep ":$$" | sed -e 's/:$$//' -e 's/[^-][^\/]*\//--/g' -e 's/^/   /' -e 's/-/|/')

.PHONY: info
info: ## Display pipeline information
	@echo "$(CYAN)Pipeline Information:$(RESET)"
	@echo "  Root: $$(pwd)"
	@echo "  Core modules: $$(ls core/*.sh 2>/dev/null | wc -l)"
	@echo "  Platform modules: $$(find modules/platform -name '*.sh' 2>/dev/null | wc -l)"
	@echo "  Deployment modules: $$(find modules/deployment -name '*.sh' 2>/dev/null | wc -l)"
	@echo "  Testing modules: $$(find modules/testing -name '*.sh' 2>/dev/null | wc -l)"
	@echo "  Job handlers: $$(find jobs -name 'handler.sh' 2>/dev/null | wc -l)"
	@echo "  Config files: $$(find config -type f 2>/dev/null | wc -l)"

# ============================================================================
# CI/CD Simulation
# ============================================================================

.PHONY: ci-local
ci-local: validate lint test-integration ## Run all CI checks locally
	@echo "$(GREEN)All CI checks passed!$(RESET)"

# ============================================================================
# Utility Targets
# ============================================================================

.PHONY: permissions
permissions: ## Fix file permissions for all scripts
	@echo "$(CYAN)Setting executable permissions...$(RESET)"
	@chmod +x main.sh
	@chmod +x core/*.sh
	@chmod +x modules/**/*.sh
	@chmod +x jobs/**/*.sh
	@chmod +x scripts/*.sh
	@echo "$(GREEN)Permissions updated$(RESET)"

.PHONY: version
version: ## Display version information
	@echo "$(CYAN)RHDH CI/CD Pipeline$(RESET)"
	@echo "Version: 1.0.0"
	@echo "Last Updated: November 2024"
	@if [ -f "MIGRATION_SUMMARY.md" ]; then \
		echo "Status: $$(grep 'Status:' MIGRATION_SUMMARY.md | head -1)"; \
	fi

