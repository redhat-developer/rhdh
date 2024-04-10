#!/bin/bash
set -a  # Automatically export all variables

#ENVS and Vault Secrets
IBM_REGION=eu-de
IBM_RSC_GROUP=backstage-rsc-group
HELM_CHART_VALUE_FILE_NAME="values_showcase.yaml"
HELM_IMAGE_NAME=backstage
HELM_REPO_NAME=rhdh-chart
HELM_REPO_URL="https://charts.openshift.io/"
IBM_OPENSHIFT_ENDPOINT="https://c115-e.eu-de.containers.cloud.ibm.com:31836"
K8S_CLUSTER_ROUTER_BASE="backstage-os-2-eu-de-2-bx-c74b3ed44ce86949f501aefb2db80652-0000.eu-de.containers.appdomain.cloud"
K8S_CLUSTER_TOKEN=$(cat /tmp/secrets/K8S_CLUSTER_TOKEN)
K8S_CLUSTER_URL=https://c115-e.eu-de.containers.cloud.ibm.com:31836
OPENSHIFT_CLUSTER_ID=ck9hkc0f0bjvg4sq1ps0

RELEASE_NAME=rhdh
CHART_VERSION="2.13.3"
GITHUB_APP_APP_ID=Mzc2ODY2
GITHUB_APP_CLIENT_ID=SXYxLjdiZDNlZDFmZjY3MmY3ZDg=
GITHUB_APP_PRIVATE_KEY=$(cat /tmp/secrets/GITHUB_APP_PRIVATE_KEY)
GITHUB_APP_CLIENT_SECRET=$(cat /tmp/secrets/GITHUB_APP_CLIENT_SECRET)
GITHUB_APP_WEBHOOK_URL=aHR0cHM6Ly9zbWVlLmlvL0NrRUNLYVgwNzhyZVhobEpEVzA=
GITHUB_APP_WEBHOOK_SECRET=$(cat /tmp/secrets/GITHUB_APP_WEBHOOK_SECRET)
GITHUB_URL=aHR0cHM6Ly9naXRodWIuY29t
GITHUB_ORG=amFudXMtcWU=

K8S_CLUSTER_NAME=Y2k1aGp2ZmYwMG8yZzY2OXZxOGc=
K8S_CLUSTER_API_SERVER_URL=aHR0cHM6Ly9jMTE0LWUuZXUtZGUuY29udGFpbmVycy5jbG91ZC5pYm0uY29tOjMxNTA2
K8S_SERVICE_ACCOUNT_TOKEN=$(cat /tmp/secrets/K8S_SERVICE_ACCOUNT_TOKEN)
OCM_CLUSTER_URL=aHR0cHM6Ly9jMTE1LWUuZXUtZGUuY29udGFpbmVycy5jbG91ZC5pYm0uY29tOjMxODM2
OCM_CLUSTER_TOKEN=$(cat /tmp/secrets/OCM_CLUSTER_TOKEN)
KEYCLOAK_BASE_URL=aHR0cHM6Ly9rZXljbG9hay1rZXljbG9hay5iYWNrc3RhZ2Utb3MtMi1ldS1kZS0yLWJ4LWM3NGIzZWQ0NGNlODY5NDlmNTAxYWVmYjJkYjgwNjUyLTAwMDAuZXUtZGUuY29udGFpbmVycy5hcHBkb21haW4uY2xvdWQ=
KEYCLOAK_LOGIN_REALM=bXlyZWFsbQ==
KEYCLOAK_REALM=bXlyZWFsbQ==
KEYCLOAK_CLIENT_ID=bXljbGllbnQ=
KEYCLOAK_CLIENT_SECRET=$(cat /tmp/secrets/KEYCLOAK_CLIENT_SECRET)
ACR_SECRET=$(cat /tmp/secrets/ACR_SECRET)
DH_TARGET_URL=aHR0cDovL3Rlc3QtYmFja3N0YWdlLWN1c3RvbWl6YXRpb24tcHJvdmlkZXItc2hvd2Nhc2UuYmFja3N0YWdlLW9zLTItZXUtZGUtMi1ieC1jNzRiM2VkNDRjZTg2OTQ5ZjUwMWFlZmIyZGI4MDY1Mi0wMDAwLmV1LWRlLmNvbnRhaW5lcnMuYXBwZG9tYWluLmNsb3Vk
GOOGLE_CLIENT_ID=$(cat /tmp/secrets/GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(cat /tmp/secrets/GOOGLE_CLIENT_SECRET)

set +a  # Stop automatically exporting variables
