# Backstage Showcase CI/CD Pipeline Makefile

.PHONY: help install build clean test lint format deploy test-e2e validate

# Default target
help:
	@echo "Available targets:"
	@echo "  install        - Install dependencies"
	@echo "  build          - Build TypeScript code"
	@echo "  clean          - Clean build artifacts"
	@echo "  test           - Run unit tests"
	@echo "  lint           - Run linter"
	@echo "  format         - Format code"
	@echo "  validate       - Validate pipeline configuration"
	@echo ""
	@echo "Deployment targets:"
	@echo "  deploy-ocp     - Deploy to OpenShift"
	@echo "  deploy-aks     - Deploy to AKS"
	@echo "  deploy-gke     - Deploy to GKE"
	@echo ""
	@echo "Job targets:"
	@echo "  job-nightly    - Run nightly job"
	@echo "  job-aks        - Run AKS job"
	@echo "  job-gke        - Run GKE job"
	@echo ""
	@echo "E2E Test targets:"
	@echo "  test-showcase  - Run showcase tests"
	@echo "  test-rbac      - Run RBAC tests"
	@echo "  test-runtime   - Run runtime tests"

# Install dependencies
install:
	npm install

# Build TypeScript code
build:
	npm run build

# Clean build artifacts
clean:
	npm run clean
	rm -rf node_modules
	rm -rf artifacts
	rm -rf shared

# Run tests
test:
	npm test

# Run linter
lint:
	npm run lint

# Format code
format:
	npm run format

# Validate configuration
validate:
	npm run build
	node dist/main.js validate

# Deploy to OpenShift
deploy-ocp:
	node dist/main.js deploy -c ocp -m helm -n showcase

# Deploy to OpenShift with RBAC
deploy-ocp-rbac:
	node dist/main.js deploy -c ocp -m helm -n showcase-rbac --rbac

# Deploy to AKS
deploy-aks:
	node dist/main.js deploy -c aks -m helm -n showcase-k8s

# Deploy to GKE
deploy-gke:
	node dist/main.js deploy -c gke -m helm -n showcase-gke

# Run nightly job
job-nightly:
	node dist/main.js run-job -j ocp-nightly

# Run AKS job
job-aks:
	node dist/main.js run-job -j aks-helm

# Run GKE job
job-gke:
	node dist/main.js run-job -j gke-operator

# Run showcase tests
test-showcase:
	node dist/main.js test -p showcase -n showcase -u https://rhdh-developer-hub-showcase.$(K8S_CLUSTER_ROUTER_BASE)

# Run RBAC tests
test-rbac:
	node dist/main.js test -p showcase-rbac -n showcase-rbac -u https://rhdh-rbac-developer-hub-showcase-rbac.$(K8S_CLUSTER_ROUTER_BASE)

# Run runtime tests
test-runtime:
	node dist/main.js test -p showcase-runtime -n showcase-runtime -u https://rhdh-developer-hub-showcase-runtime.$(K8S_CLUSTER_ROUTER_BASE)

# Clean namespace
clean-namespace:
	node dist/main.js clean -n showcase

# Setup auth providers
setup-auth:
	@echo "Setting up authentication providers..."
	@echo "Export the following environment variables:"
	@echo "  export GITHUB_APP_CLIENT_ID=your-github-client-id"
	@echo "  export GITHUB_APP_CLIENT_SECRET=your-github-client-secret"
	@echo "  export GOOGLE_CLIENT_ID=your-google-client-id"
	@echo "  export GOOGLE_CLIENT_SECRET=your-google-client-secret"

# Full CI/CD pipeline
pipeline: validate build job-nightly

# Development mode
dev:
	npm run dev 