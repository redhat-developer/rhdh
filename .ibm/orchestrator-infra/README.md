# Orchestrator Infrastructure Only

This project deploys the complete infrastructure needed for the Orchestrator plugin without
RHDH/Backstage. It includes all the supporting services required for workflow orchestration.

## Components

- **PostgreSQL**: Database for storing workflow data and orchestrator metadata
- **Keycloak**: Identity and access management for authentication (optional)
- **Serverless Logic Operator**: Manages SonataFlow workflows
- **SonataFlow Platform**: Provides Data Index and Job Service
- **Sample Workflows**: Pre-configured workflow examples
- **GitOps Configuration**: ArgoCD setup for continuous deployment (optional)

## Prerequisites

- OpenShift 4.10+ cluster
- `oc` CLI installed and configured
- Cluster admin privileges
- Git (optional, for GitOps features)

## Quick Start

```bash
# Make scripts executable
chmod +x deploy-orchestrator.sh scripts/*.sh

# Deploy all components
./deploy-orchestrator.sh

# Deploy without Keycloak
./deploy-orchestrator.sh --no-keycloak

# Deploy with GitOps
./deploy-orchestrator.sh --enable-gitops

# Update existing deployment (don't clean namespace)
./deploy-orchestrator.sh --no-clean

# Use custom namespace
./deploy-orchestrator.sh --namespace my-orchestrator
```

## Individual Component Deployment

You can deploy components individually:

```bash
# Deploy PostgreSQL only
./scripts/02-deploy-postgresql.sh

# Deploy Keycloak only
./scripts/01-deploy-keycloak.sh

# Deploy Serverless Logic Operator and SonataFlow
./scripts/03-deploy-serverless-operator.sh

# Deploy sample workflows
./scripts/04-deploy-workflows.sh

# Configure GitOps
./scripts/05-deploy-gitops.sh
```

## Configuration

### PostgreSQL

- **Database**: `backstage_plugin_orchestrator`
- **Schema**: `orchestrator`
- **Default Credentials**:
  - Admin: `postgres` / `postgres123`
  - Orchestrator: `orchestrator` / `orchestrator123`

### Keycloak

- **Admin Console**: Available via OpenShift route
- **Default Admin**: `admin` / `admin123`
- **Realm**: `orchestrator`
- **Client ID**: `orchestrator`

### SonataFlow Services

- **Data Index Service**: Indexes workflow instances for querying
- **Job Service**: Manages workflow timers and scheduled tasks

## Integration with RHDH/Backstage

To integrate this infrastructure with your RHDH/Backstage instance:

1. **Add Orchestrator Dynamic Plugins** to your Backstage configuration:

```yaml
plugins:
  - package: "@redhat/backstage-plugin-orchestrator-backend-dynamic"
    pluginConfig:
      orchestrator:
        dataIndexService:
          url: http://sonataflow-platform-data-index-service.orchestrator-infra/graphql
          # Or with full URL:
          # url: http://sonataflow-platform-data-index-service.orchestrator-infra.svc.cluster.local:80/graphql

  - package: "@redhat/backstage-plugin-orchestrator"
    # Frontend configuration...
```

2. **Configure Database Connection** in Backstage:

```yaml
backend:
  database:
    client: pg
    connection:
      host: postgresql.orchestrator-infra.svc.cluster.local
      port: 5432
      user: orchestrator
      password: orchestrator123
      database: backstage_plugin_orchestrator
```

3. **Configure Authentication** (if using Keycloak):

```yaml
auth:
  providers:
    oidc:
      development:
        metadataUrl: https://<keycloak-route>/realms/orchestrator/.well-known/openid-configuration
        clientId: orchestrator
        clientSecret: orchestrator-secret
```

## Accessing Services

After deployment, you can access the services:

```bash
# Get all routes
oc get routes -n orchestrator-infra

# Get service endpoints
oc get svc -n orchestrator-infra

# Check pod status
oc get pods -n orchestrator-infra

# View logs
oc logs -n orchestrator-infra <pod-name>
```

## Sample Workflows

The deployment includes sample workflows:

- **user-onboarding**: Demonstrates user onboarding process
- **infrastructure-provisioning**: Shows infrastructure provisioning workflow

To list deployed workflows:

```bash
oc get sonataflow -n orchestrator-infra
```

## GitOps Management

If GitOps is enabled, the infrastructure is managed by ArgoCD:

```bash
# Get ArgoCD URL
oc get route openshift-gitops-server -n openshift-gitops

# Get admin password
oc get secret openshift-gitops-cluster -n openshift-gitops -o jsonpath='{.data.admin\.password}' | base64 -d
```

## Troubleshooting

### PostgreSQL Connection Issues

```bash
# Test database connection
oc exec -it postgresql-0 -n orchestrator-infra -- psql -U postgres -d backstage_plugin_orchestrator -c "\dt"
```

### Logic Operator CSV Failed

If the Logic Operator CSV shows `Failed` state but CRDs are installed, this is expected behavior.
The operator installs CRDs successfully even when CSV shows Failed status. Verify:

```bash
# Check if CRDs are available
oc get crd sonataflowplatforms.sonataflow.org

# Check if controller is running
oc get pods -n openshift-serverless-logic
```

### SonataFlow Services Not Starting

```bash
# Check SonataFlowPlatform status
oc describe sonataflowplatform sonataflow-platform -n orchestrator-infra

# Check Data Index logs
oc logs -l app=sonataflow-platform-data-index-service -n orchestrator-infra

# Verify Logic Operator controller is running
oc get pods -n openshift-serverless-logic -l app.kubernetes.io/name=sonataflow-operator
```

### Workflow Deployment Issues

```bash
# Check workflow status
oc get sonataflow -n orchestrator-infra
oc describe sonataflow orchestrator-infra < workflow-name > -n
```

## Uninstall

To remove all components:

```bash
# Delete namespace and all resources
oc delete namespace orchestrator-infra
oc delete namespace openshift-serverless-logic

# Remove GitOps artifacts (if deployed)
oc delete application orchestrator-infra -n openshift-gitops
```

## Support

For issues or questions:

- Check the logs: `oc logs -n orchestrator-infra <pod-name>`
- Review events: `oc get events -n orchestrator-infra`
- Consult the [Orchestrator documentation](https://github.com/parodos-dev/orchestrator-helm-chart)
