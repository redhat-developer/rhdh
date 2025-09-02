#!/bin/bash

# Check if prow log URL is provided as parameter, otherwise prompt for it
if [[ $# -eq 0 ]]; then
  read -p "Enter the prow log url: " input_url
else
  input_url="$1"
fi

id=$(echo "$input_url" | awk -F'/' '{print $NF}')
job=$(echo "$input_url" | awk -F'/' '{print $(NF-1)}')

build_log_url="https://prow.ci.openshift.org/log?container=test&id=${id}&job=${job}"
namespace=$(curl -s $build_log_url | grep "The claimed cluster" | sed -E 's/.*The claimed cluster ([^.]+)\ is ready after.*/\1/')

# Output the constructed URL
echo "Prow build log URL: $build_log_url"
echo "hosted-mgmt Namespace: $namespace"

if [[ -z "$namespace" ]]; then
  echo "Cluster claim not found. Please provide a valid prow url that uses cluster claim."
  exit 1
elif [[ ! "$namespace" =~ ^rhdh-[0-9]+-[0-9]+-us-east-2 ]]; then
  echo "Namespace must match pattern 'rhdh-[version]-us-east-2'."
  exit 1
fi

# Log in to the cluster
oc login --web https://api.hosted-mgmt.ci.devcluster.openshift.com:6443

if ! oc get namespace "$namespace" > /dev/null 2>&1; then
  echo "Namespace ${namespace} is expired or deleted, exiting..."
  exit 1
fi

# Try to retrieve secrets from the namespace
namespace_secrets=$(oc get secrets -n "$namespace" 2>&1)
if echo "$namespace_secrets" | grep -q "Forbidden"; then
  echo "Error: You do not have access to the namespace '$namespace'."
  echo "check if you are member of 'rhdh-pool-admins' group at: https://rover.redhat.com/groups/search?q=rhdh-pool-admins"
  echo "Please reach out to the rhdh-qe team for assistance."
  exit 1
fi

cluster_secret=$(oc get secrets -n "$namespace" | grep admin-password | awk '{print $1}')
# Retrieve the kubeadmin password from the specified namespace
password=$(oc get secret $cluster_secret -n "$namespace" -o jsonpath='{.data.password}' | base64 -d)

# Log out from the current session
oc logout

# Log in to the namespace-specific cluster
oc login https://api."$namespace".rhdh-qe.devcluster.openshift.com:6443 --username kubeadmin --password "$password" --insecure-skip-tls-verify=true
oc project showcase

# Prompt the user to open the web console
read -p "Do you want to open the OpenShift web console? (y/n): " open_console

if [[ "$open_console" == "y" || "$open_console" == "Y" ]]; then

  console_url="https://console-openshift-console.apps.${namespace}.rhdh-qe.devcluster.openshift.com/dashboards"

  echo "Opening web console at $console_url..."
  echo "Use bellow user and password to login into web console:"
  echo "Username: kubeadmin"
  echo "Password: $password"
  echo "Password copied to clipboard"
  echo $password | pbcopy
  sleep 3

  # Attempt to open the web console in the default browser
  if command -v xdg-open &> /dev/null; then
    xdg-open "$console_url" # For Linux systems
  elif command -v open &> /dev/null; then
    open "$console_url" # For macOS
  else
    echo "Unable to detect a browser. Please open the following URL manually:"
    echo "$console_url"
  fi
else
  echo "Web console not opened."
fi
