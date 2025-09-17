#!/bin/bash

set -e

# === CONFIGURABLE VARIABLES ===
PROJECT_ID="rhdh-qe"
REGION="us-central1"
FUNCTION_NAME="labelCluster"
BUCKET_NAME="${PROJECT_ID}-functions"
SERVICE_ACCOUNT_NAME="cluster-labeler"
SERVICE_ACCOUNT_EMAIL="${SERVICE_ACCOUNT_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
PROJECT_NUMBER=$(gcloud projects describe $PROJECT_ID --format="value(projectNumber)")

echo ">>> Enabling required APIs..."
gcloud services enable \
  cloudfunctions.googleapis.com \
  eventarc.googleapis.com \
  logging.googleapis.com \
  cloudbuild.googleapis.com \
  container.googleapis.com \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  pubsub.googleapis.com \
  --quiet

echo ">>> Creating GCS bucket (if not exists)..."
if ! gsutil ls -b "gs://${BUCKET_NAME}" > /dev/null 2>&1; then
  gsutil mb -p "$PROJECT_ID" -l "$REGION" "gs://${BUCKET_NAME}"
else
  echo "Bucket already exists."
fi

echo ">>> Creating service account (if not exists)..."
if ! gcloud iam service-accounts describe "$SERVICE_ACCOUNT_EMAIL" --quiet > /dev/null 2>&1; then
  gcloud iam service-accounts create "$SERVICE_ACCOUNT_NAME" \
    --description="Service Account to label clusters" \
    --display-name="Cluster Labeler" \
    --quiet
else
  echo "Service account already exists."
fi

echo ">>> Assigning roles to service account..."
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/container.admin" \
  --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/logging.viewer" \
  --quiet

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${SERVICE_ACCOUNT_EMAIL}" \
  --role="roles/eventarc.eventReceiver" \
  --quiet

echo ">>> Configuring EventArc Service Agent permissions..."
# Grant necessary permissions to EventArc Service Agent
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/eventarc.serviceAgent" \
  --quiet

# Grant permission to invoke the function
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-eventarc.iam.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --quiet

echo ">>> Enabling Audit Logs for container.googleapis.com..."
# Create a temporary policy file to enable audit logs
cat > audit-policy.json << EOF
{
  "auditConfigs": [
    {
      "service": "container.googleapis.com",
      "auditLogConfigs": [
        {
          "logType": "ADMIN_READ"
        },
        {
          "logType": "DATA_READ"
        },
        {
          "logType": "DATA_WRITE"
        }
      ]
    }
  ]
}
EOF

# Get current IAM policy
gcloud projects get-iam-policy "$PROJECT_ID" --format=json > current-policy.json

# Merge audit config with current policy
python3 -c "
import json

# Load current policy
with open('current-policy.json', 'r') as f:
    policy = json.load(f)

# Load audit config
with open('audit-policy.json', 'r') as f:
    audit_config = json.load(f)

# Add audit configs to policy
if 'auditConfigs' not in policy:
    policy['auditConfigs'] = []

# Check if container.googleapis.com already has audit config
existing_config = None
for config in policy['auditConfigs']:
    if config.get('service') == 'container.googleapis.com':
        existing_config = config
        break

if existing_config:
    # Update existing config
    existing_config['auditLogConfigs'] = audit_config['auditConfigs'][0]['auditLogConfigs']
else:
    # Add new config
    policy['auditConfigs'].extend(audit_config['auditConfigs'])

# Save updated policy
with open('updated-policy.json', 'w') as f:
    json.dump(policy, f, indent=2)
"

# Set the updated policy
gcloud projects set-iam-policy "$PROJECT_ID" updated-policy.json --quiet

# Clean up temporary files
rm -f audit-policy.json current-policy.json updated-policy.json

echo ">>> Waiting for EventArc permissions to propagate (30 seconds)..."
sleep 30

echo ">>> Deploying Cloud Function..."
gcloud functions deploy "$FUNCTION_NAME" \
  --gen2 \
  --runtime=nodejs20 \
  --region="$REGION" \
  --source=. \
  --entry-point=labelCluster \
  --trigger-event-filters="type=google.cloud.audit.log.v1.written" \
  --trigger-event-filters="serviceName=container.googleapis.com" \
  --trigger-event-filters="methodName=google.container.v1.ClusterManager.CreateCluster" \
  --service-account="$SERVICE_ACCOUNT_EMAIL" \
  --memory=256Mi \
  --timeout=60s \
  --quiet

echo ">>> Done! Your Cloud Function '$FUNCTION_NAME' is deployed and listening for GKE cluster creations."
echo ">>> Function URL: https://$REGION-$PROJECT_ID.cloudfunctions.net/$FUNCTION_NAME"
