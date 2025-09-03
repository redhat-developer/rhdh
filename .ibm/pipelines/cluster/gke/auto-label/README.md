# 🏷️ GKE Cluster Auto-Labeler

This project automatically applies standardized labels to new Google Kubernetes Engine (GKE)
clusters in the `rhdh-qe` GCP project. The system uses Cloud Functions triggered by EventArc to
monitor cluster creation events and apply labels immediately.

## Overview

The auto-labeler ensures consistent tagging across all GKE clusters with these labels:

- `app-code=rhdh-003`
- `service-phase=dev`
- `cost-center=726`

## Architecture

The solution consists of:

- **Cloud Function**: Processes cluster creation events and applies labels
- **EventArc Trigger**: Monitors GKE API audit logs for cluster creation
- **Service Account**: Provides necessary permissions for cluster management
- **Audit Logs**: Captures cluster creation events from Container API

## Prerequisites

Before deploying, ensure you have:

- ✅ Google Cloud SDK installed and authenticated
- ✅ Access to the `rhdh-qe` GCP project
- ✅ Required IAM permissions:
  - `roles/cloudfunctions.admin`
  - `roles/iam.admin`
  - `roles/eventarc.admin`
  - `roles/logging.admin`
- ✅ Python 3.x installed (for audit log configuration)

## Quick Start

1. **Navigate to the project directory**:

   ```bash
   cd .ibm/pipelines/cluster/gke/auto-label
   ```

2. **Make the setup script executable**:

   ```bash
   chmod +x deploy-auto-labeler.sh
   chmod +x apply-labels-manual.sh
   ```

3. **Deploy the auto-labeler**:
   ```bash
   ./deploy-auto-labeler.sh
   ```

The script automatically:

- Enables required GCP APIs
- Creates necessary service accounts and permissions
- Configures audit logging for the Container API
- Deploys the Cloud Function with EventArc trigger

## Usage

### Automatic Labeling (Recommended)

Once deployed, the Cloud Function automatically labels new clusters. Create a test cluster:

```bash
gcloud container clusters create test-cluster \
  --zone=us-central1-a \
  --num-nodes=1 \
  --machine-type=e2-medium
```

### Manual Labeling

For existing clusters, use the manual labeling script:

```bash
# Interactive mode - lists clusters and prompts for selection
./apply-labels-manual.sh

# Apply to specific cluster
./apply-labels-manual.sh my-cluster us-central1-a

# Apply to all clusters in the project
./apply-labels-manual.sh --all

# Show help
./apply-labels-manual.sh --help
```

## Configuration

### Environment Variables

The setup script uses these configurable variables:

| Variable               | Default Value     | Description          |
| ---------------------- | ----------------- | -------------------- |
| `PROJECT_ID`           | `rhdh-qe`         | Target GCP project   |
| `REGION`               | `us-central1`     | Deployment region    |
| `FUNCTION_NAME`        | `labelCluster`    | Cloud Function name  |
| `SERVICE_ACCOUNT_NAME` | `cluster-labeler` | Service account name |

### Labels Applied

The following labels are automatically applied to new clusters:

| Label Key       | Value      | Purpose                 |
| --------------- | ---------- | ----------------------- |
| `app-code`      | `rhdh-003` | Application identifier  |
| `service-phase` | `dev`      | Environment designation |
| `cost-center`   | `726`      | Cost tracking           |

To modify labels, edit the `labels` object in `index.js`:

```javascript
const labels = {
  "app-code": "rhdh-003",
  "service-phase": "dev",
  "cost-center": "726",
};
```

## File Structure

```
.
├── index.js               # Cloud Function implementation
├── package.json           # Node.js project configuration
├── deploy-auto-labeler.sh # Automated deployment script
├── apply-labels-manual.sh # Manual labeling script for existing clusters
└── README.md              # Documentation
```

## Monitoring and Debugging

### Viewing Function Logs

```bash
gcloud functions logs read labelCluster --region=us-central1 --limit=50
```

### Testing the Function

Create a test cluster to verify the auto-labeler:

```bash
gcloud container clusters create test-cluster \
  --zone=us-central1-a \
  --num-nodes=1 \
  --machine-type=e2-medium
```

Check if labels were applied:

```bash
gcloud container clusters describe test-cluster \
  --zone=us-central1-a \
  --format="value(resourceLabels)"
```

### Verifying All Clusters

List all clusters with their labels:

```bash
gcloud container clusters list \
  --format="table(name,location,resourceLabels)"
```

### Common Issues

| Issue                  | Cause                       | Solution                           |
| ---------------------- | --------------------------- | ---------------------------------- |
| Function not triggered | Audit logs not enabled      | Re-run setup script                |
| Permission denied      | Missing IAM roles           | Verify service account permissions |
| Labels not applied     | Cluster in different region | Check location detection logic     |
| Script asks questions  | APIs not enabled            | All APIs now enabled automatically |

## Updating the Function

To update the function code:

1. **Modify `index.js`** with your changes
2. **Redeploy the function**:
   ```bash
   gcloud functions deploy labelCluster \
     --gen2 \
     --runtime=nodejs20 \
     --region=us-central1 \
     --source=. \
     --entry-point=labelCluster \
     --quiet
   ```

## Security Considerations

- The service account follows the principle of least privilege
- Audit logs capture all cluster management activities
- Function execution is limited to 60 seconds to prevent runaway processes
- All operations are logged for compliance and debugging

## Troubleshooting

### Function Deployment Issues

1. **API not enabled**: All required APIs are now enabled automatically
2. **Insufficient permissions**: Verify your account has necessary IAM roles
3. **Region mismatch**: Confirm all resources use the same region

### Event Processing Issues

1. **Events not received**: Check EventArc trigger configuration
2. **Parsing errors**: Verify audit log format in function logs
3. **Command failures**: Validate gcloud CLI is available in function environment

### Manual Script Issues

1. **Permission denied**: Ensure you have `roles/container.admin`
2. **Cluster not found**: Verify cluster name and location are correct
3. **Invalid location**: Use exact zone/region names from `gcloud container clusters list`

## Support

For issues or questions:

1. Check function logs for error details
2. Verify EventArc trigger is active
3. Confirm audit logging is enabled for Container API
4. Review service account permissions

## Contributing

When making changes:

1. Test locally where possible
2. Follow existing code patterns
3. Update documentation for new features
4. Verify labels comply with GCP naming conventions
