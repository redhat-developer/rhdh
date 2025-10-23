#!/bin/bash

# shellcheck source=.ibm/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ibm/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh

gcloud_ssl_cert_create() {
  local cert_name=$1
  local domain=$2
  local project=$3

  local output
  output=$(gcloud compute ssl-certificates create "${cert_name}" --domains="${domain}" --project="${project}" --global 2>&1) || true

  # Check if the output contains ERROR
  if echo "$output" | grep -q "ERROR"; then
    # Check if the error is due to certificate already existing
    if echo "$output" | grep -q "already exists"; then
      echo "Certificate '${cert_name}' already exists, continuing..."
    else
      echo "Error creating certificate '${cert_name}':"
      echo "$output"
      exit 1
    fi
  else
    echo "Certificate '${cert_name}' created successfully."
    echo "The test might fail if the certificate is not obtained from the certificate authority in time."
  fi
}

cleanup_gke() {
  delete_tekton_pipelines
  uninstall_olm
  delete_rhdh_operator
}
