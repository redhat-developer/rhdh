# RHDH CI/CD Pipeline

Modular CI/CD pipeline infrastructure for Red Hat Developer Hub (RHDH) testing across multiple Kubernetes platforms.

## Overview

This is a complete refactoring of the original `.ibm/pipelines` structure into a clean, modular, and scalable architecture. The pipeline currently supports OpenShift Pull Request testing, with the foundation ready for additional platforms and job types.

## Directory Structure

```
pipelines/
├── README.md                        # This file
├── PLATFORM_ABSTRACTION.md          # Platform abstraction layer documentation
├── main.sh                          # Entry point - routes jobs to handlers
├── core/                            # Shared core modules
│   ├── env.sh                       # Environment variables and secrets
│   ├── logging.sh                   # Logging utilities with colors
│   ├── reporting.sh                 # Test reporting and artifact management
│   └── k8s.sh                       # Kubernetes/OpenShift utilities
├── modules/                         # Functional modules
│   ├── platform/
│   │   ├── common.sh                # Shared multi-platform functions
│   │   ├── ocp.sh                   # OpenShift-specific operations
│   │   ├── aks.sh                   # Azure Kubernetes Service operations
│   │   └── eks.sh                   # Amazon EKS operations
│   ├── deployment/
│   │   └── helm.sh                  # Helm deployment logic
│   └── testing/
│       └── playwright.sh            # Playwright test execution
├── jobs/                            # Job handlers
│   └── ocp-pull/
│       ├── handler.sh               # OCP Pull job orchestration
│       └── config.sh                # Job-specific configuration
├── config/                          # Configuration files
│   ├── helm-values/
│   │   ├── showcase.yaml           # Base deployment values
│   │   └── showcase-rbac.yaml      # RBAC deployment values
│   └── k8s-resources/
│       ├── configmaps/             # ConfigMaps for RHDH
│       ├── rbac/                   # RBAC resources
│       ├── service-accounts/       # Service accounts
│       ├── redis/                  # Redis cache
│       ├── tekton/                 # Tekton pipelines
│       ├── topology/               # Topology test resources
│       └── postgres/               # PostgreSQL database
└── scripts/                        # Utility scripts
    └── cleanup.sh                  # Cleanup test resources
```

## Quick Start

### Prerequisites

- OpenShift CLI (`oc`) or Kubernetes CLI (`kubectl`)
- Helm 3+
- Bash 4+
- Access to OpenShift cluster
- Required secrets mounted at `/tmp/secrets/`

### Running OCP Pull Tests

```bash
# Set required environment variables
export JOB_NAME="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm-pull"
export TAG_NAME="pr-1234"
export PULL_NUMBER="1234"
export BUILD_ID="test-build"
export K8S_CLUSTER_TOKEN="your-token"
export K8S_CLUSTER_URL="https://api.your-cluster.com:6443"

# Run the pipeline
./pipelines/main.sh
```

### Cleanup After Tests

```bash
# Clean up everything (namespaces, temp files, artifacts)
./pipelines/scripts/cleanup.sh

# Keep test artifacts for analysis
./pipelines/scripts/cleanup.sh --keep-artifacts

# Skip namespace cleanup (if cluster access is not available)
./pipelines/scripts/cleanup.sh --skip-namespaces
```

## Architecture

### Design Principles

1. **Modularity**: Each component has a single, well-defined responsibility
2. **Reusability**: Core modules are shared across all jobs
3. **Extensibility**: Easy to add new platforms (AKS, EKS, GKE) and job types
4. **Separation of Concerns**: Configuration is separated from logic
5. **Testability**: Functions are small and independently testable
6. **Documentation**: All code is documented in English with clear comments

### Core Modules

#### `core/env.sh`

- Environment variable management
- Secret loading from vault
- Cluster configuration
- Path detection

#### `core/logging.sh`

- Colored console output
- Log levels (info, success, warning, error, debug)
- Command execution wrappers
- Progress indicators

#### `core/reporting.sh`

- Deployment status tracking
- Test result reporting
- JUnit XML processing
- Artifact URL generation

#### `core/k8s.sh`

- Pod log collection
- YAML file merging with yq
- Resource waiting (deployments, services, endpoints)
- Namespace management
- Secret management
- Operator installation

### Platform Modules

#### `modules/platform/common.sh`

Shared multi-platform functions:

- Platform detection (OpenShift vs Kubernetes)
- Cluster authentication (oc/kubectl abstraction)
- Ingress/Route management
- OLM and Tekton installation
- CLI wrapper functions

#### `modules/platform/ocp.sh`

OpenShift-specific operations:

- Operator installations (Pipelines, ACM, Postgres, Serverless)
- Cluster setup for Helm/Operator deployments
- Orchestrator infrastructure
- Uses common.sh for shared functionality

#### `modules/platform/aks.sh`

Azure Kubernetes Service operations:

- AKS cluster authentication with Azure CLI
- NGINX Ingress Controller installation
- Azure Disk storage configuration
- Cert-Manager and Azure Workload Identity
- Cluster setup for AKS deployments

#### `modules/platform/eks.sh`

Amazon EKS operations:

- EKS cluster authentication with AWS CLI
- AWS Load Balancer Controller installation
- EBS CSI driver and gp3 storage configuration
- Cert-Manager and External DNS
- Cluster setup for EKS deployments

**Platform Abstraction**: See [PLATFORM_ABSTRACTION.md](./PLATFORM_ABSTRACTION.md) for detailed documentation on the multi-platform architecture.

### Deployment Modules

#### `modules/deployment/helm.sh`

Helm deployment logic:

- Helm install/upgrade operations
- Kubernetes resource application
- Test customization provider
- Redis cache deployment
- PostgreSQL configuration
- Orchestrator workflows

### Testing Modules

#### `modules/testing/playwright.sh`

Playwright test execution:

- Backstage health checks
- Test environment setup
- Yarn dependency installation
- Test execution with Xvfb
- Artifact collection

## Job Handlers

### OCP Pull (`jobs/ocp-pull/`)

Handles OpenShift Pull Request testing:

**Workflow:**

1. Login to OpenShift cluster
2. Detect cluster router base
3. Detect platform information
4. Setup cluster (install operators)
5. Deploy RHDH instances (base + RBAC)
6. Deploy test customization provider
7. Run Playwright tests
8. Generate test reports

**Configuration** (`jobs/ocp-pull/config.sh`):

- Namespace names
- Release names
- Helm value files
- Timeout settings
- Feature flags

## Configuration

### Environment Variables

Key environment variables (defined in `core/env.sh`):

| Variable            | Description          | Example                                                |
| ------------------- | -------------------- | ------------------------------------------------------ |
| `JOB_NAME`          | CI job identifier    | `pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm-pull` |
| `TAG_NAME`          | Container image tag  | `pr-1234`                                              |
| `PULL_NUMBER`       | GitHub PR number     | `1234`                                                 |
| `BUILD_ID`          | CI build identifier  | `build-20240101-123456`                                |
| `K8S_CLUSTER_TOKEN` | Cluster access token | `sha256~...`                                           |
| `K8S_CLUSTER_URL`   | Cluster API URL      | `https://api.cluster.com:6443`                         |
| `CHART_VERSION`     | Helm chart version   | `1.9-123-CI`                                           |

### Secrets

Secrets are loaded from `/tmp/secrets/` (mounted by CI):

- `QUAY_NAMESPACE` - Quay repository namespace
- `QUAY_TOKEN` - Quay authentication token
- `GITHUB_APP_*` - GitHub App credentials
- `GH_USER_*` - Test user credentials
- `KEYCLOAK_*` - Keycloak configuration
- `REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON` - Registry pull secret

### Local Development Override

Create `config/env_override.local.sh` to override environment variables for local testing:

```bash
# config/env_override.local.sh
export K8S_CLUSTER_TOKEN="my-local-token"
export K8S_CLUSTER_URL="https://api.local-cluster.com:6443"
export TAG_NAME="local-test"
# ... other overrides
```

**Note:** This file is gitignored and should NOT be committed.

## Adding New Jobs

### Structure

1. Create job directory: `jobs/<job-name>/`
2. Create handler: `jobs/<job-name>/handler.sh`
3. Create config: `jobs/<job-name>/config.sh`
4. Define handler function: `handle_<job_name>()`
5. Add routing in `main.sh`

### Example: Adding AKS Job

```bash
# 1. Create structure
mkdir -p jobs/aks-helm

# 2. Create handler
cat > jobs/aks-helm/handler.sh << 'EOF'
#!/bin/bash
source "${PIPELINES_ROOT}/modules/platform/aks.sh"
source "${PIPELINES_ROOT}/modules/deployment/helm.sh"
source "${PIPELINES_ROOT}/modules/testing/playwright.sh"
source "${PIPELINES_ROOT}/jobs/aks-helm/config.sh"

handle_aks_helm() {
  log_section "Starting AKS Helm Testing Job"
  # ... implementation
}
EOF

# 3. Create config
cat > jobs/aks-helm/config.sh << 'EOF'
#!/bin/bash
export AKS_CLUSTER_NAME="${AKS_CLUSTER_NAME:-rhdh-test}"
# ... other config
EOF

# 4. Add routing in main.sh
# Add case in main.sh:
#   *aks*helm*)
#     source "${PIPELINES_ROOT}/jobs/aks-helm/handler.sh"
#     handle_aks_helm
#     ;;
```

## Troubleshooting

### Check Pipeline Logs

Logs are saved to `${ARTIFACT_DIR}/`:

- Main log: `test-log.html`
- Pod logs: `pod_logs/`
- Test results: `test-results/`
- Screenshots: `attachments/screenshots/`

### Debug Mode

Enable debug logging:

```bash
export ISRUNNINGLOCALDEBUG=true
export DEBUG=true
./pipelines/main.sh
```

### Common Issues

#### Namespace Stuck in Terminating

```bash
# Force delete namespace
./pipelines/scripts/cleanup.sh
```

#### Tests Fail to Connect to Backstage

Check:

1. Route is exposed: `oc get route -n showcase`
2. Pod is running: `oc get pods -n showcase`
3. Backstage URL is correct
4. Cluster router base is detected correctly

#### Operator Installation Timeout

Increase timeout in job config:

```bash
export DEPLOYMENT_TIMEOUT_MINUTES=10
```

## CI/CD Integration

### OpenShift CI (Prow)

The pipeline is designed for OpenShift CI but can run anywhere:

```yaml
# .ci-operator.yaml
tests:
  - as: e2e-ocp-helm-pull
    commands: |
      export JOB_NAME="pull-ci-redhat-developer-rhdh-main-e2e-ocp-helm-pull"
      ./pipelines/main.sh
    container:
      from: test-image
```

### Artifacts

Artifacts are saved to `${ARTIFACT_DIR}` and available at:

- Pull requests: `https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/pr-logs/...`
- Periodic jobs: `https://gcsweb-ci.apps.ci.l2s4.p1.openshiftapps.com/gcs/test-platform-results/logs/...`

## Migration from `.ibm/pipelines`

This structure currently implements only **OCP Pull**. Other jobs still use `.ibm/pipelines`.

### Differences

| Feature       | `.ibm/pipelines`  | New `pipelines/`         |
| ------------- | ----------------- | ------------------------ |
| Structure     | Flat              | Modular                  |
| Functions     | Mixed in utils.sh | Organized by module      |
| Configuration | Hardcoded         | Separated in config/     |
| Logging       | Basic echo        | Colored, leveled logging |
| Extensibility | Difficult         | Easy to add jobs         |
| Documentation | Scattered         | Centralized in README    |

### Future Migration

Planned migrations:

- [ ] OCP Nightly
- [ ] OCP Upgrade
- [ ] AKS Helm
- [ ] EKS Helm
- [ ] GKE Helm
- [ ] Operator deployments

## Platform Support

### Supported Platforms

| Platform        | Status         | Module                       | Documentation               |
| --------------- | -------------- | ---------------------------- | --------------------------- |
| **OpenShift**   | ✅ Implemented | `modules/platform/ocp.sh`    | OCP Pull job                |
| **Azure AKS**   | ✅ Ready       | `modules/platform/aks.sh`    | See PLATFORM_ABSTRACTION.md |
| **Amazon EKS**  | ✅ Ready       | `modules/platform/eks.sh`    | See PLATFORM_ABSTRACTION.md |
| **Google GKE**  | 🚧 Planned     | -                            | Future implementation       |
| **Generic K8s** | ✅ Supported   | `modules/platform/common.sh` | Via common functions        |

### Adding a New Platform

See [PLATFORM_ABSTRACTION.md](./PLATFORM_ABSTRACTION.md#adding-a-new-platform-example-gke) for step-by-step guide.

## Contributing

### Code Style

1. **All code comments MUST be in English**
2. **All log messages MUST be in English**
3. Use `shellcheck` for linting
4. Follow existing naming conventions
5. Add logging to all major operations
6. Document functions with usage comments
7. Use platform abstraction layer for multi-platform support

### Testing

Before submitting changes:

1. Test locally if possible
2. Verify shellcheck passes: `shellcheck pipelines/**/*.sh`
3. Test the full workflow in a test cluster
4. Verify cleanup works correctly

## License

See LICENSE file in project root.

## Support

For issues and questions:

- Create an issue in the repository
- Check existing documentation
- Review CI job logs in OpenShift CI

---

**Version:** 1.0.0  
**Last Updated:** November 2024  
**Maintainers:** RHDH QE Team
