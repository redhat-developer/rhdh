#!/bin/bash
set -a  # Automatically export all variables

#ENVS and Vault Secrets
HELM_CHART_VALUE_FILE_NAME="values_showcase.yaml"
HELM_CHART_RBAC_VALUE_FILE_NAME="values_showcase-rbac.yaml"
HELM_CHART_K8S_MERGED_VALUE_FILE_NAME="merged-values_showcase_K8S.yaml"
HELM_CHART_RBAC_K8S_MERGED_VALUE_FILE_NAME="merged-values_showcase-rbac_K8S.yaml"
HELM_CHART_AKS_DIFF_VALUE_FILE_NAME="diff-values_showcase_AKS.yaml"
HELM_CHART_RBAC_AKS_DIFF_VALUE_FILE_NAME="diff-values_showcase-rbac_AKS.yaml"
HELM_CHART_GKE_DIFF_VALUE_FILE_NAME="diff-values_showcase_GKE.yaml"
HELM_CHART_RBAC_GKE_DIFF_VALUE_FILE_NAME="diff-values_showcase-rbac_GKE.yaml"
HELM_CHART_SANITY_PLUGINS_DIFF_VALUE_FILE_NAME="diff-values_showcase-sanity-plugins.yaml"
HELM_CHART_SANITY_PLUGINS_MERGED_VALUE_FILE_NAME="merged-values_showcase-sanity-plugins.yaml"

HELM_IMAGE_NAME=backstage
HELM_REPO_NAME=rhdh-chart
HELM_REPO_URL="https://redhat-developer.github.io/rhdh-chart"
K8S_CLUSTER_TOKEN_ENCODED=$(printf "%s" $K8S_CLUSTER_TOKEN | base64 | tr -d '\n')
QUAY_REPO="${QUAY_REPO:-rhdh-community/rhdh}"

RELEASE_NAME=rhdh
RELEASE_NAME_RBAC=rhdh-rbac
NAME_SPACE="${NAME_SPACE:-showcase}"
NAME_SPACE_RBAC="${NAME_SPACE_RBAC:-showcase-rbac}"
NAME_SPACE_RUNTIME="${NAME_SPACE_RUNTIME:-showcase-runtime}"
NAME_SPACE_POSTGRES_DB="${NAME_SPACE_POSTGRES_DB:-postgress-external-db}"
NAME_SPACE_SANITY_PLUGINS_CHECK="showcase-sanity-plugins"
OPERATOR_MANAGER='rhdh-operator'
CHART_VERSION="2.15.2" # Fixed version should be used for release branches.
CHART_VERSION_BASE="2.15.2"
GITHUB_APP_APP_ID=$(cat /tmp/secrets/GITHUB_APP_3_APP_ID)
GITHUB_APP_CLIENT_ID=$(cat /tmp/secrets/GITHUB_APP_3_CLIENT_ID)
GITHUB_APP_PRIVATE_KEY=$(cat /tmp/secrets/GITHUB_APP_3_PRIVATE_KEY)
GITHUB_APP_CLIENT_SECRET=$(cat /tmp/secrets/GITHUB_APP_3_CLIENT_SECRET)
GITHUB_APP_JANUS_TEST_APP_ID=OTE3NjM5
GITHUB_APP_JANUS_TEST_CLIENT_ID=SXYyM2xpSEdtU1l6SUFEbHFIakw=
GITHUB_APP_JANUS_TEST_PRIVATE_KEY=$(cat /tmp/secrets/GITHUB_APP_JANUS_TEST_PRIVATE_KEY)
GITHUB_APP_JANUS_TEST_CLIENT_SECRET=$(cat /tmp/secrets/GITHUB_APP_JANUS_TEST_CLIENT_SECRET)
GITHUB_APP_WEBHOOK_URL=aHR0cHM6Ly9zbWVlLmlvL0NrRUNLYVgwNzhyZVhobEpEVzA=
GITHUB_APP_WEBHOOK_SECRET=$(cat /tmp/secrets/GITHUB_APP_WEBHOOK_SECRET)
GITHUB_URL=aHR0cHM6Ly9naXRodWIuY29t
GITHUB_ORG=amFudXMtcWU=
GITHUB_ORG_2=amFudXMtdGVzdA==
GH_USER_ID=$(cat /tmp/secrets/GH_USER_ID)
GH_USER_PASS=$(cat /tmp/secrets/GH_USER_PASS)
GH_2FA_SECRET=$(cat /tmp/secrets/GH_2FA_SECRET)
GH_USER2_ID=$(cat /tmp/secrets/GH_USER2_ID)
GH_USER2_PASS=$(cat /tmp/secrets/GH_USER2_PASS)
GH_USER2_2FA_SECRET=$(cat /tmp/secrets/GH_USER2_2FA_SECRET)
GH_RHDH_QE_USER_TOKEN=$(cat /tmp/secrets/GH_RHDH_QE_USER_TOKEN)
QE_USER3_ID=$(cat /tmp/secrets/QE_USER3_ID)
QE_USER3_PASS=$(cat /tmp/secrets/QE_USER3_PASS)
QE_USER4_ID=$(cat /tmp/secrets/QE_USER4_ID)
QE_USER4_PASS=$(cat /tmp/secrets/QE_USER4_PASS)

K8S_CLUSTER_TOKEN_TEMPORARY=$(cat /tmp/secrets/K8S_CLUSTER_TOKEN_TEMPORARY)

GITLAB_TOKEN=$(cat /tmp/secrets/GITLAB_TOKEN)

RHDH_PR_OS_CLUSTER_URL=$(cat /tmp/secrets/RHDH_PR_OS_CLUSTER_URL)
RHDH_PR_OS_CLUSTER_TOKEN=$(cat /tmp/secrets/RHDH_PR_OS_CLUSTER_TOKEN)
ENCODED_CLUSTER_NAME=$(echo "my-cluster" | base64)
K8S_CLUSTER_API_SERVER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
K8S_SERVICE_ACCOUNT_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
OCM_CLUSTER_URL=$(printf "%s" "$K8S_CLUSTER_URL" | base64 | tr -d '\n')
OCM_CLUSTER_TOKEN=$K8S_CLUSTER_TOKEN_ENCODED
KEYCLOAK_BASE_URL=$(cat /tmp/secrets/KEYCLOAK_BASE_URL)
KEYCLOAK_BASE_URL_ENCODED=$(printf "%s" $KEYCLOAK_BASE_URL | base64 | tr -d '\n')
KEYCLOAK_LOGIN_REALM="myrealm"
KEYCLOAK_LOGIN_REALM_ENCODED=$(printf "%s" $KEYCLOAK_LOGIN_REALM | base64 | tr -d '\n')
KEYCLOAK_REALM="myrealm"
KEYCLOAK_REALM_ENCODED=$(printf "%s" $KEYCLOAK_REALM | base64 | tr -d '\n')
KEYCLOAK_CLIENT_ID="myclient"
KEYCLOAK_CLIENT_ID_ENCODED=$(printf "%s" $KEYCLOAK_CLIENT_ID | base64 | tr -d '\n')
KEYCLOAK_CLIENT_SECRET=$(cat /tmp/secrets/KEYCLOAK_CLIENT_SECRET)
KEYCLOAK_CLIENT_SECRET_ENCODED=$(printf "%s" $KEYCLOAK_CLIENT_SECRET | base64 | tr -d '\n')
ACR_SECRET=$(cat /tmp/secrets/ACR_SECRET)
GOOGLE_CLIENT_ID=$(cat /tmp/secrets/GOOGLE_CLIENT_ID)
GOOGLE_CLIENT_SECRET=$(cat /tmp/secrets/GOOGLE_CLIENT_SECRET)
GOOGLE_ACC_COOKIE=$(cat /tmp/secrets/GOOGLE_ACC_COOKIE)
GOOGLE_USER_ID=$(cat /tmp/secrets/GOOGLE_USER_ID)
GOOGLE_USER_PASS=$(cat /tmp/secrets/GOOGLE_USER_PASS)
GOOGLE_2FA_SECRET=$(cat /tmp/secrets/GOOGLE_2FA_SECRET)
RDS_USER='cmhkaHFl'
RDS_PASSWORD=$(cat /tmp/secrets/RDS_PASSWORD)
RDS_1_HOST=$(cat /tmp/secrets/RDS_1_HOST)
RDS_2_HOST=$(cat /tmp/secrets/RDS_2_HOST)
RDS_3_HOST=$(cat /tmp/secrets/RDS_3_HOST)

JUNIT_RESULTS="junit-results.xml"
DATA_ROUTER_URL=$(cat /tmp/secrets/DATA_ROUTER_URL)
DATA_ROUTER_USERNAME=$(cat /tmp/secrets/DATA_ROUTER_USERNAME)
DATA_ROUTER_PASSWORD=$(cat /tmp/secrets/DATA_ROUTER_PASSWORD)
DATA_ROUTER_PROJECT="main"
DATA_ROUTER_AUTO_FINALIZATION_TRESHOLD=$(cat /tmp/secrets/DATA_ROUTER_AUTO_FINALIZATION_TRESHOLD)
DATA_ROUTER_NEXUS_HOSTNAME=$(cat /tmp/secrets/DATA_ROUTER_NEXUS_HOSTNAME)
REPORTPORTAL_HOSTNAME=$(cat /tmp/secrets/REPORTPORTAL_HOSTNAME)
SLACK_DATA_ROUTER_WEBHOOK_URL=$(cat /tmp/secrets/SLACK_DATA_ROUTER_WEBHOOK_URL)
REDIS_USERNAME=temp
REDIS_USERNAME_ENCODED=$(printf "%s" $REDIS_USERNAME | base64 | tr -d '\n')
REDIS_PASSWORD=test123
REDIS_PASSWORD_ENCODED=$(printf "%s" $REDIS_PASSWORD | base64 | tr -d '\n')

GKE_CLUSTER_NAME=$(cat /tmp/secrets/GKE_CLUSTER_NAME)
GKE_CLUSTER_REGION=$(cat /tmp/secrets/GKE_CLUSTER_REGION)
GKE_INSTANCE_DOMAIN_NAME=$(cat /tmp/secrets/GKE_INSTANCE_DOMAIN_NAME)
GKE_SERVICE_ACCOUNT_NAME=$(cat /tmp/secrets/GKE_SERVICE_ACCOUNT_NAME)
GKE_CERT_NAME=$(cat /tmp/secrets/GKE_CERT_NAME)
GOOGLE_CLOUD_PROJECT=$(cat /tmp/secrets/GOOGLE_CLOUD_PROJECT)

# authentication providers variables
RHSSO76_ADMIN_USERNAME=$(cat /tmp/secrets/RHSSO76_ADMIN_USERNAME)
RHSSO76_ADMIN_PASSWORD=$(cat /tmp/secrets/RHSSO76_ADMIN_PASSWORD)
RHSSO76_DEFAULT_PASSWORD=$(cat /tmp/secrets/RHSSO76_DEFAULT_PASSWORD)
RHSSO76_URL=$(cat /tmp/secrets/RHSSO76_URL)
RHSSO76_CLIENT_SECRET=$(cat /tmp/secrets/RHSSO76_CLIENT_SECRET)
RHSSO76_CLIENT_ID="myclient"
AUTH_PROVIDERS_REALM_NAME="authProviders"

RHBK_ADMIN_USERNAME=$(cat /tmp/secrets/RHBK_ADMIN_USERNAME)
RHBK_ADMIN_PASSWORD=$(cat /tmp/secrets/RHBK_ADMIN_PASSWORD)
RHSSO76_DEFAULT_PASSWORD=$(cat /tmp/secrets/RHSSO76_DEFAULT_PASSWORD)
RHBK_URL=$(cat /tmp/secrets/RHBK_URL)
RHBK_METADATA_URL=$(cat /tmp/secrets/RHBK_METADATA_URL)
RHBK_CLIENT_SECRET=$(cat /tmp/secrets/RHBK_CLIENT_SECRET)
RHBK_CLIENT_ID="myclient"

AZURE_LOGIN_USERNAME=$(cat /tmp/secrets/AZURE_LOGIN_USERNAME)
AZURE_LOGIN_PASSWORD=$(cat /tmp/secrets/AZURE_LOGIN_PASSWORD)
AUTH_PROVIDERS_AZURE_CLIENT_ID=$(cat /tmp/secrets/AUTH_PROVIDERS_AZURE_CLIENT_ID)
AUTH_PROVIDERS_AZURE_CLIENT_SECRET=$(cat /tmp/secrets/AUTH_PROVIDERS_AZURE_CLIENT_SECRET)
AUTH_PROVIDERS_AZURE_TENANT_ID=$(cat /tmp/secrets/AUTH_PROVIDERS_AZURE_TENANT_ID)

AUTH_PROVIDERS_GH_ORG_NAME="rhdhqeauthorg"
AUTH_PROVIDERS_GH_USER_2FA=$(cat /tmp/secrets/AUTH_PROVIDERS_GH_USER_2FA)
AUTH_PROVIDERS_GH_ADMIN_2FA=$(cat /tmp/secrets/AUTH_PROVIDERS_GH_ADMIN_2FA)
AUTH_ORG_APP_ID=$(cat /tmp/secrets/AUTH_ORG_APP_ID)
AUTH_ORG_CLIENT_ID=$(cat /tmp/secrets/AUTH_ORG_CLIENT_ID)
AUTH_ORG_CLIENT_SECRET=$(cat /tmp/secrets/AUTH_ORG_CLIENT_SECRET)
AUTH_ORG1_PRIVATE_KEY=$(cat /tmp/secrets/AUTH_ORG1_PRIVATE_KEY)
AUTH_ORG_PK=$(cat /tmp/secrets/AUTH_ORG_PK)
AUTH_ORG_WEBHOOK_SECRET=$(cat /tmp/secrets/AUTH_ORG_WEBHOOK_SECRET)
GH_USER_PASSWORD=$(cat /tmp/secrets/GH_USER_PASSWORD)

AUTH_PROVIDERS_RELEASE="rhdh-auth-providers"
AUTH_PROVIDERS_NAMESPACE="showcase-auth-providers"
STATIC_API_TOKEN=$(cat /tmp/secrets/STATIC_API_TOKEN)
AUTH_PROVIDERS_CHART="rhdh-chart/backstage"

KEYCLOAK_AUTH_BASE_URL=$(cat /tmp/secrets/KEYCLOAK_AUTH_BASE_URL)
KEYCLOAK_AUTH_CLIENTID=$(cat /tmp/secrets/KEYCLOAK_AUTH_CLIENTID)
KEYCLOAK_AUTH_CLIENT_SECRET=$(cat /tmp/secrets/KEYCLOAK_AUTH_CLIENT_SECRET)
KEYCLOAK_AUTH_LOGIN_REALM=$(cat /tmp/secrets/KEYCLOAK_AUTH_LOGIN_REALM)
KEYCLOAK_AUTH_REALM=$(cat /tmp/secrets/KEYCLOAK_AUTH_REALM)

REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON=$(cat /tmp/secrets/REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON)

IS_OPENSHIFT=""

set +a  # Stop automatically exporting variables

detect_ocp_and_set_env_var
