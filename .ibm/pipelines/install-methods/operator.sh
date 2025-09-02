#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh

install_rhdh_operator() {
  local namespace=$1
  local max_attempts=$2

  configure_namespace "$namespace"

  if [[ -z "${IS_OPENSHIFT}" || "${IS_OPENSHIFT,,}" == "false" ]]; then
    setup_image_pull_secret "rhdh-operator" "rh-pull-secret" "${REGISTRY_REDHAT_IO_SERVICE_ACCOUNT_DOCKERCONFIGJSON}"
  fi
  # Make sure script is up to date
  rm -f /tmp/install-rhdh-catalog-source.sh
  curl -L "https://raw.githubusercontent.com/redhat-developer/rhdh-operator/refs/heads/${RELEASE_BRANCH_NAME}/.rhdh/scripts/install-rhdh-catalog-source.sh" > /tmp/install-rhdh-catalog-source.sh
  chmod +x /tmp/install-rhdh-catalog-source.sh
  if [[ "$RELEASE_BRANCH_NAME" == "main" ]]; then
    echo "Installing RHDH operator with '--next' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      if output=$(bash -x /tmp/install-rhdh-catalog-source.sh --next --install-operator rhdh); then
        echo "${output}"
        echo "RHDH Operator installed on attempt ${i}."
        break
      elif ((i < max_attempts)); then
        echo "Attempt ${i} failed, retrying in 10 seconds..."
        sleep 10
      elif ((i == max_attempts)); then
        echo "$output"
        echo "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  else
    local operator_version="${RELEASE_BRANCH_NAME#release-}"
    if [[ -z "$operator_version" ]]; then
      echo "Error: Failed to extract operator version from RELEASE_BRANCH_NAME: '$RELEASE_BRANCH_NAME'"
      return 1
    fi
    echo "Installing RHDH operator with '-v $operator_version' flag"
    for ((i = 1; i <= max_attempts; i++)); do
      if output=$(bash -x /tmp/install-rhdh-catalog-source.sh -v "$operator_version" --install-operator rhdh); then
        echo "${output}"
        echo "RHDH Operator installed on attempt ${i}."
        break
      elif ((i == max_attempts)); then
        echo "${output}"
        echo "Failed install RHDH Operator after ${max_attempts} attempts."
        return 1
      fi
    done
  fi
}

prepare_operator() {
  local retry_operator_installation="${1:-1}"
  configure_namespace "${OPERATOR_MANAGER}"
  install_rhdh_operator "${OPERATOR_MANAGER}" "$retry_operator_installation"
}

wait_for_backstage_crd() {
  local namespace=$1
  timeout 300 bash -c "
  while ! oc get crd/backstages.rhdh.redhat.com -n '${namespace}' >/dev/null 2>&1; do
      echo 'Waiting for Backstage CRD to be created...'
      sleep 20
  done
  echo 'Backstage CRD is created.'
  " || echo "Error: Timed out waiting for Backstage CRD creation."
}

deploy_rhdh_operator() {
  local namespace=$1
  local backstage_crd_path=$2

  wait_for_backstage_crd "$namespace"]
  rendered_yaml=$(envsubst < "$backstage_crd_path")
  echo -e "Applying Backstage CRD from: $backstage_crd_path\n$rendered_yaml"
  echo "$rendered_yaml" | oc apply -f - -n "$namespace"
}

delete_rhdh_operator() {
  kubectl delete namespace "$OPERATOR_MANAGER" --ignore-not-found
}
