# 🚀 OpenShift Dedicated (OSD) Management Scripts

> Automated scripts for managing OpenShift Dedicated clusters on Google Cloud Platform using OCM
> CLI.

## 🔧 Prerequisites

Before you begin, ensure you have:

- [ ] OCM CLI installed
- [ ] Access to OpenShift Cluster Manager
- [ ] GCP Service Account with appropriate permissions
- [ ] Valid OCM CLIENT_ID and CLIENT_SECRET

### Setting Up Service Accounts

#### 1. GCP Service Account

- Obtain the GCP service account JSON from
  [here](https://vault.ci.openshift.org/ui/vault/secrets/kv/kv/selfservice%2Frhdh-qe%2Fosd-gcp)
- Look for the `gcp_service_account_json` secret
- Save this JSON file as your service account file
- Reference this file in the `--service-account-file` parameter in create-osd.sh

#### 2. OCM Service Account

1. Visit [Red Hat Console IAM Service Accounts](https://console.redhat.com/iam/service-accounts)
2. Click "Create service account"
3. Fill in the required information
4. Save the generated CLIENT_ID and CLIENT_SECRET
5. Use these credentials in your environment variables

## ⚙️ Configuration

Make scripts executable:

```bash
chmod +x create-osd.sh destroy-osd.sh
```

### Required Environment Variables

```bash
# Set your workspace directory
export WORKSPACE="/path/to/workspace"

# OCM Credentials
export CLIENT_ID="your_client_id"
export CLIENT_SECRET="your_client_secret"

# Optional: Custom cluster name
export CLUSTER_NAME="your-cluster-name"
```

## 🚀 Usage

### Creating a Cluster

```bash
./create-osd.sh
```

This will:

1. Create a new OSD cluster on GCP
2. Set up HTPasswd authentication
3. Configure admin user
4. Generate access credentials
5. Create kubeconfig file

### Destroying Clusters

```bash
./destroy-osd.sh
```

This will remove all clusters matching the specified name pattern.

## 📖 Scripts Overview

### `create-osd.sh`

Creates an OpenShift Dedicated cluster with the following specifications:

- OSD Version: 4.16.16
- Region: us-east1
- Provider: GCP
- Subscription: marketplace-gcp

#### Output Files

| File                  | Description                    |
| --------------------- | ------------------------------ |
| `cluster-info.name`   | Cluster name                   |
| `cluster-info.id`     | Cluster ID                     |
| `cluster-config.yaml` | Access details and credentials |
| `kubeconfig`          | Kubernetes configuration       |
| `cluster-info.yaml`   | Detailed cluster information   |

### `destroy-osd.sh`

Handles cluster cleanup:

- Identifies clusters by name pattern
- Initiates deletion process
- Monitors uninstallation progress

### ⚠️ GitHub Authentication Limitation

> **Important**: Due to GitHub App limitations, GitHub login functionality will not work in
> ephemeral environments.

### 🧪 Running Tests on OSD Cluster

To run existing tests on an OSD cluster:

1. Update cluster credentials in OpenShift vault:
   - Add new secrets or update the existing one:
     - `RHDH_OSD_GCP_CLUSTER_URL`: Your cluster's API URL
     - `RHDH_OSD_GCP_CLUSTER_TOKEN`: Your cluster's access token

2. Modify your `openshift-ci-tests.sh` to use OSD cluster:

```bash
# Add these lines to set_cluster_info function
export K8S_CLUSTER_URL=$(cat /tmp/secrets/RHDH_OSD_GCP_CLUSTER_URL)
export K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_OSD_GCP_CLUSTER_TOKEN)
```

3. Create a Pull Request with these changes to trigger tests on OSD cluster

## 📝 Notes

- Default cluster naming: `osdgcp-MMDD`
- Creation time: ~30-45 minutes
- Deletion time: ~15-30 minutes
- Uses latest OpenShift client binaries
