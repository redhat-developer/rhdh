# RHDH (Red Hat Developer Hub) Repository Context

This document serves as a comprehensive starting point for LLMs working with the RHDH repository. It provides detailed information about the testing infrastructure, CI/CD pipeline, dynamic plugins system, and development workflows.

## Table of Contents

- [E2E Testing Framework](#e2e-testing-framework)
- [CI/CD Infrastructure](#cicd-infrastructure)
- [Dynamic Plugins System](#dynamic-plugins-system)
- [Development Workflow](#development-workflow)
- [Key Dependencies and Common Issues](#key-dependencies-and-common-issues)
- [Documentation References](#documentation-references)

## E2E Testing Framework

### Technology Stack
- **Testing Framework**: Playwright with TypeScript
- **Node.js Version**: 22
- **Package Manager**: Yarn 3.8.7
- **Test Runner**: Playwright Test
- **Reporting**: HTML, JUnit XML, List reporters

### Test Structure and Organization

#### Directory Structure
```
e2e-tests/
├── playwright/
│   ├── e2e/                    # Main test files
│   │   ├── authProviders/      # Authentication provider tests
│   │   ├── plugins/           # Plugin-specific tests
│   │   ├── configuration-test/ # Configuration tests
│   │   ├── audit-log/         # Audit log tests
│   │   └── *.spec.ts          # General test files
│   ├── utils/                 # Test utilities
│   ├── data/                  # Test data
│   └── support/               # Test support files
├── tests/                     # Additional test files
├── tests-examples/           # Example tests
├── scripts/                  # Test scripts
├── screenshots/              # Test screenshots
├── test-results/             # Test results
└── playwright-report/        # Playwright reports
```

#### Key Test Categories

1. **Smoke Tests** (`smoke-test.spec.ts`)
   - Basic functionality verification
   - Health checks and core features

2. **Showcase Tests** (Multiple projects)
   - `showcase`: General functionality tests
   - `showcase-rbac`: Role-based access control tests
   - `showcase-k8s`: Kubernetes integration tests
   - `showcase-operator`: Operator-based deployment tests
   - `showcase-runtime`: Runtime environment tests
   - `showcase-upgrade`: Upgrade scenario tests

3. **Authentication Provider Tests** (`showcase-auth-providers`)
   - OIDC (Red Hat Backstage Keycloak)
   - Microsoft OAuth2
   - GitHub authentication
   - LDAP (Active Directory)

4. **Plugin Tests** (`playwright/e2e/plugins/`)
   - RBAC (Role-Based Access Control)
   - Kubernetes actions
   - Notifications
   - Topology
   - Quay integration
   - Tekton
   - Dynamic plugins info
   - Adoption insights
   - Analytics

5. **Configuration Tests** (`playwright/e2e/configuration-test/`)
   - Config map validation
   - Environment-specific configurations

6. **Audit Log Tests** (`playwright/e2e/audit-log/`)
   - Audit logging functionality
   - Compliance verification

### Test Execution Scripts

Available yarn scripts in `e2e-tests/package.json`:

```bash
# Showcase tests
yarn showcase                    # General showcase tests
yarn showcase-rbac              # RBAC showcase tests
yarn showcase-k8s-ci-nightly    # Kubernetes showcase tests
yarn showcase-operator-nightly  # Operator showcase tests
yarn showcase-runtime           # Runtime showcase tests
yarn showcase-upgrade-nightly   # Upgrade showcase tests

# Authentication provider tests
yarn showcase-auth-providers    # Auth provider tests

# Plugin tests
yarn showcase-sanity-plugins    # Plugin sanity tests

# Utility scripts
yarn lint:check                 # Lint checking
yarn lint:fix                   # Lint fixing
yarn tsc                        # TypeScript compilation
yarn prettier:check            # Prettier checking
yarn prettier:fix              # Prettier fixing
```

### Environment Variables

Required environment variables for test execution:

```bash
# Base configuration
BASE_URL                        # Base URL for the application
JOB_NAME                        # CI job name
IS_OPENSHIFT                    # OpenShift environment flag

# Authentication providers
GITHUB_TOKEN                    # GitHub authentication token
KEYCLOAK_AUTH_BASE_URL          # Keycloak base URL
KEYCLOAK_AUTH_CLIENTID          # Keycloak client ID
KEYCLOAK_AUTH_CLIENT_SECRET     # Keycloak client secret
KEYCLOAK_AUTH_LOGIN_REALM       # Keycloak login realm
KEYCLOAK_AUTH_REALM             # Keycloak realm

# Local development
ISRUNNINGLOCAL                  # Local development flag
ISRUNNINGLOCALDEBUG             # Local debug flag
```

### Test Configuration

Playwright configuration (`e2e-tests/playwright.config.ts`):
- **Timeout**: 90 seconds global, 10-15 seconds for actions
- **Retries**: 2 on CI, 0 locally
- **Workers**: 3 parallel workers
- **Viewport**: 1920x1080
- **Video**: Enabled for all tests
- **Screenshots**: Only on failure
- **Trace**: Retain on failure

### Test Projects

The configuration defines multiple test projects:
- `smoke-test`: Basic smoke tests with 10 retries
- `showcase`: General functionality tests
- `showcase-rbac`: RBAC-specific tests
- `showcase-auth-providers`: Authentication provider tests
- `showcase-k8s`: Kubernetes integration tests
- `showcase-operator`: Operator-based tests
- `showcase-runtime`: Runtime environment tests
- `showcase-upgrade`: Upgrade scenario tests

## CI/CD Infrastructure

### OpenShift CI Overview

The RHDH CI/CD pipeline uses **OpenShift CI** with **Prow-based** automation and **ephemeral clusters** for testing.

#### Key Components

1. **Ephemeral Clusters**: AWS-based clusters in `us-east-2` region
2. **Cluster Management**: Managed via cluster claims
3. **CI Job Types**: OCP, EKS, GKE, AKS environments
4. **Authentication**: Keycloak as default provider
5. **Secrets Management**: Vault-managed secrets

### Cluster Pools

Available cluster pools for different OCP versions:

- **RHDH-4-17-US-EAST-2**
  - Usage: PR checks on main branch and OCP v4.17 nightly jobs
  - [Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-17-0-amd64-aws-us-east-2_clusterpool.yaml)

- **RHDH-4-16-US-EAST-2**
  - Usage: OCP v4.16 nightly jobs
  - [Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-16-0-amd64-aws-us-east-2_clusterpool.yaml)

- **RHDH-4-15-US-EAST-2**
  - Usage: OCP v4.15 nightly jobs
  - [Configuration](https://github.com/openshift/release/blob/master/clusters/hosted-mgmt/hive/pools/rhdh/rhdh-ocp-4-15-0-amd64-aws-us-east-2_clusterpool.yaml)

### CI Job Types

#### Pull Request Tests
- **Trigger**: Automatic for code changes, manual with `/ok-to-test`
- **Environment**: Ephemeral OpenShift cluster
- **Scope**: Both RBAC and non-RBAC namespaces
- **Artifacts**: 6-month retention period

#### Nightly Tests
- **Schedule**: Automated nightly runs
- **Environments**: Multiple OCP versions, AKS, GKE
- **Reporting**: Slack notifications to `#rhdh-e2e-test-alerts`

### Key CI Scripts

#### Main Orchestration
- **`.ibm/pipelines/openshift-ci-tests.sh`**: Main test orchestration script
- **`.ibm/pipelines/utils.sh`**: Utility functions
- **`.ibm/pipelines/reporting.sh`**: Reporting and notifications
- **`.ibm/pipelines/env_variables.sh`**: Environment variable management

#### Job Handlers
The main script handles different job types:
- `handle_aks_helm`: AKS Helm deployment
- `handle_eks_helm`: EKS Helm deployment
- `handle_gke_helm`: GKE Helm deployment
- `handle_ocp_operator`: OCP Operator deployment
- `handle_ocp_nightly`: OCP nightly tests
- `handle_ocp_pull`: OCP PR tests
- `handle_auth_providers`: Auth provider tests

### Access and Debugging

#### Cluster Access
For cluster pool admins, use the login script:
```bash
.ibm/pipelines/ocp-cluster-claim-login.sh
```

#### Debugging Process
1. Run the login script
2. Provide Prow log URL when prompted
3. Script will forward cluster web console URL and credentials
4. Ephemeral clusters are deleted after CI job termination

### CI Configuration Files

- **Job Definitions**: [OpenShift Release Jobs](https://github.com/openshift/release/tree/master/ci-operator/jobs/redhat-developer/rhdh)
- **Configuration**: [OpenShift Release Config](https://github.com/openshift/release/tree/master/ci-operator/config/redhat-developer/rhdh)
- **Step Registry**: [OpenShift Release Steps](https://github.com/openshift/release/tree/master/ci-operator/step-registry/redhat-developer/rhdh)

## Dynamic Plugins System

### Overview

RHDH supports dynamic plugins that can be installed/uninstalled without rebuilding the application. The system is based on the [backend plugin manager package](https://github.com/backstage/backstage/tree/master/packages/backend-dynamic-feature-service).

### Plugin Management

#### Location and Structure
```
dynamic-plugins/
├── wrappers/                   # Plugin wrapper packages
├── imports/                    # Imported plugins
├── _utils/                     # Utility functions
├── package.json               # Package configuration
└── turbo.json                 # Turbo configuration
```

#### Plugin Categories

1. **Catalog Backend Modules**
   - GitHub, GitLab, Bitbucket integration
   - LDAP, Keycloak, Microsoft Graph
   - PingIdentity, Bitbucket Cloud/Server

2. **Scaffolder Modules**
   - Kubernetes, Quay, Azure, GitHub
   - GitLab, Bitbucket, Gerrit
   - ServiceNow, SonarQube, Regex

3. **Authentication Providers**
   - OIDC, OAuth2, LDAP
   - GitHub, Microsoft, Keycloak

4. **Infrastructure Plugins**
   - Kubernetes, ArgoCD, Tekton
   - Jenkins, Azure DevOps
   - Dynatrace, PagerDuty

5. **Quality and Monitoring**
   - SonarQube, Lighthouse
   - Analytics, Notifications
   - Audit logging

6. **Artifact Management**
   - Quay, Nexus Repository Manager
   - JFrog Artifactory, ACR

### Plugin Configuration

#### Installation Process
1. **Package Format**: OCI image, tgz archive, npm package
2. **Configuration File**: `dynamic-plugins.yaml`
3. **Installation Script**: `docker/install-dynamic-plugins.py`
4. **Restart Required**: Only restart needed, no rebuild

#### Configuration Structure
```yaml
plugins:
  - package: ./dynamic-plugins/dist/plugin-name
    disabled: false
    integrity: "sha512-..."
    pluginConfig:
      # Plugin-specific configuration
```

#### Frontend Plugin Wiring
Dynamic frontend plugins require additional configuration:
```yaml
dynamicPlugins:
  frontend:
    plugin-name:
      dynamicRoutes:
        - path: /my-plugin
          importName: MyPluginPage
          menuItem:
            icon: myIcon
            text: My Plugin
      mountPoints:
        - mountPoint: plugin.mount.point
          importName: MyComponent
      appIcons:
        - name: myIcon
          importName: MyIcon
```

### Plugin Development

#### Wrapper Packages
Plugins are wrapped in dynamic plugin packages located in `dynamic-plugins/wrappers/`. Each wrapper includes:
- `package.json`: Package configuration
- `src/`: Source code
- `dist/`: Built distribution
- Configuration files

#### Export Process
1. **Source Plugin**: Original plugin source code
2. **Derived Package**: Dynamic plugin wrapper
3. **Packaging**: OCI image, tgz, or npm package
4. **Installation**: Via dynamic plugin system

## Development Workflow

### Adding New Tests

#### Test File Structure
1. **Location**: `e2e-tests/playwright/e2e/`
2. **Naming**: `*.spec.ts` for test files
3. **Organization**: Group by functionality (plugins, auth, config)

#### Test Creation Process
1. **Create Test File**: New `.spec.ts` file in appropriate directory
2. **Import Dependencies**: Playwright test utilities
3. **Write Test Cases**: Use Playwright test syntax
4. **Add to Project**: Update `playwright.config.ts` if needed
5. **Run Locally**: Test with `yarn showcase` or specific project

#### Best Practices
- Use descriptive test names
- Include proper setup and teardown
- Handle async operations correctly
- Add appropriate assertions
- Follow existing patterns and conventions

### CI Job Configuration

#### Setting Up New CI Jobs
1. **Job Definition**: Add to OpenShift release repository
2. **Configuration**: Define job parameters and environment
3. **Scripts**: Update orchestration scripts if needed
4. **Testing**: Validate job configuration locally
5. **Documentation**: Update relevant documentation

#### Job Types
- **PR Tests**: Automatic for code changes
- **Nightly Tests**: Scheduled runs
- **Optional Tests**: Manual triggers
- **Integration Tests**: Cross-environment validation

### Debugging

#### Local Development
```bash
# Set local development flags
export ISRUNNINGLOCAL=true
export ISRUNNINGLOCALDEBUG=true

# Run tests locally
npx playwright test --project showcase-auth-providers --workers 1
```

#### CI Debugging
1. **Access Logs**: Check PR artifacts or CI logs
2. **Cluster Access**: Use cluster claim login script
3. **Environment Variables**: Verify required variables
4. **Test Failures**: Review test reports and screenshots

#### Common Debugging Tools
- **Playwright Inspector**: `npx playwright test --debug`
- **Trace Viewer**: `npx playwright show-trace`
- **Screenshots**: Automatic on failure
- **Video Recording**: Available for all tests

## Key Dependencies and Common Issues

### External Services

#### Required Services
- **GitHub**: Authentication, repository access
- **Keycloak**: Default authentication provider
- **OpenShift**: Primary deployment platform
- **Advanced Cluster Management**: For OCM plugins

#### Service Configuration
- **GitHub Token**: Required for GitHub integration
- **Keycloak Credentials**: Stored in Vault
- **OpenShift Access**: Cluster credentials
- **ACM Installation**: Required for OCM plugins

### Internal Components

#### Core Components
- **Backstage**: Main application framework
- **Dynamic Plugins**: Plugin management system
- **Catalog**: Entity management
- **Scaffolder**: Template system

#### Key Dependencies
- **Node.js 22**: Runtime environment
- **Yarn 3.8.7**: Package manager
- **Playwright**: Testing framework
- **TypeScript**: Development language

### Common Issues and Solutions

#### Test Failures
1. **Environment Issues**: Verify environment variables
2. **Authentication Problems**: Check credentials and tokens
3. **Timing Issues**: Adjust timeouts in configuration
4. **Resource Constraints**: Check cluster resources

#### CI Failures
1. **Cluster Issues**: Verify cluster availability
2. **Resource Limits**: Check resource quotas
3. **Network Problems**: Verify connectivity
4. **Configuration Errors**: Review job configuration

#### Plugin Issues
1. **Loading Failures**: Check plugin configuration
2. **Dependency Conflicts**: Verify package versions
3. **Configuration Errors**: Review plugin config
4. **Build Issues**: Check build process

## Documentation References

### Core Documentation
- [E2E Testing CI Documentation](docs/e2e-tests/CI.md)
- [Dynamic Plugins Documentation](docs/dynamic-plugins/index.md)
- [Authentication Providers README](e2e-tests/playwright/e2e/authProviders/README.md)
- [OpenShift CI Pipeline README](.ibm/pipelines/README.md)

### Configuration Files
- [Playwright Configuration](e2e-tests/playwright.config.ts)
- [Package Configuration](e2e-tests/package.json)
- [Dynamic Plugins Config](dynamic-plugins/package.json)
- [CI Test Script](.ibm/pipelines/openshift-ci-tests.sh)

### External Resources
- [OpenShift CI Documentation](https://docs.ci.openshift.org/)
- [Playwright Documentation](https://playwright.dev/)
- [Red Hat Developer Hub Documentation](https://redhat-developer.github.io/red-hat-developers-documentation-rhdh/main/)
- [Backstage Documentation](https://backstage.io/docs)
- [Dynamic Plugins Guide](https://github.com/backstage/backstage/tree/master/packages/backend-dynamic-feature-service)

### Key Scripts and Tools
- [Cluster Login Script](.ibm/pipelines/ocp-cluster-claim-login.sh)
- [Test Reporting Script](.ibm/pipelines/reporting.sh)
- [Environment Variables](.ibm/pipelines/env_variables.sh)
- [Dynamic Plugin Installer](docker/install-dynamic-plugins.py)

This context file provides a comprehensive overview of the RHDH repository's testing infrastructure, CI/CD pipeline, and development workflows. Use this as a starting point for understanding the codebase and contributing to the project.
