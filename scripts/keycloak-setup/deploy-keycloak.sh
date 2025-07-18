#!/bin/bash
# Guide: https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/22.0/html-single/operator_guide/index#basic-deployment-database
# Prerequisite: Install Keycloak Operator (https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/22.0/html-single/operator_guide/index#installation-)

set -e

if ! command -v yq &> /dev/null; then
    echo "yq could not be found. Please install it to continue." >&2
    exit 1
fi

KEYCLOAK_NAMESPACE=keycloak
KEYCLOAK_OPERATOR_DISPLAY_NAME="Red Hat build of Keycloak Operator"
CERT_HOSTNAME="" # Ex: keycloak.apps-crc.testing
DELETE=false

if [ -f "${PWD}/.env" ]; then
  source "${PWD}/.env"
fi

# TODO: add method to deploy without operator for ARM systems that don't have access to the keycloak operator.
usage() {
  echo "
This script uses the Red Hat Keycloak operator to quickly setup an instance of keycloak with TLS enabled and a persistent postgresql database on Openshift Container Platform (OCP).
Prerequisites:
  - Keycloak Operator needs to be installed on the cluster (https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/22.0/html-single/operator_guide/index#installation-)
  - Be logged in to the cluster on the CLI
Usage:
  $0 [OPTIONS]

OPTIONS:
  -gc,  --generate-certs <hostname> : Generates an SSL certificate for the specified hostname. Returns a key.pem and a certificate.pem file in the ${PWD}/tls directory
  -n,   --namespace <namespace>            : The namespace the keycloak resources are installed onto. Default: keycloak
        --uninstall <options>              : Uninstall specified keycloak resources. Options:  database, keycloak, secrets, all
  -h,   --help                             : Prints this help message and exits

Examples:
$ ./deploy-keycloak.sh --generate-certs keycloak.apps.crc.test
$ ./deploy-keycloak.sh --uninstall all 

"
}
PWD="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "${PWD}"

createProject() {
  # Create Namespace and switch to it
  if ! oc get project "${KEYCLOAK_NAMESPACE}" >/dev/null 2>&1; then
    oc new-project ${KEYCLOAK_NAMESPACE}
  else
    oc project ${KEYCLOAK_NAMESPACE}
  fi
}

installKeycloakOperator() {
    if oc get csv -n "${KEYCLOAK_NAMESPACE}" | grep -q "${KEYCLOAK_OPERATOR_DISPLAY_NAME}"; then
      echo "Keycloak operator has been already installed."
    else
      echo "Keycloak operator is not installed. Installing..."
      oc apply -f "./keycloak-operator/redhat/operator-group.yaml"
      oc apply -f "./keycloak-operator/redhat/operator-subscription.yaml"
    fi

    until oc get csv -n "${KEYCLOAK_NAMESPACE}" | grep -q "${KEYCLOAK_OPERATOR_DISPLAY_NAME}.*Succeeded"; do
        echo "Waiting for the CSV to reach the 'Succeeded' phase..."
        sleep 10
    done
}

deployDB(){
  oc apply -f ${PWD}/database/postgres.yaml -n ${KEYCLOAK_NAMESPACE}
}

generateSSLCerts(){
  rm -rf  "${PWD}/tls"
  mkdir -p "${PWD}/tls"
  openssl req -subj "/CN=${CERT_HOSTNAME}/O=RHDH/C=CA" -newkey rsa:2048 -nodes -keyout "${PWD}/tls/key.pem" -x509 -days 365 -out "${PWD}/tls/certificate.pem" -addext "subjectAltName = DNS:${CERT_HOSTNAME}"
}

deployTLSKeys(){
  oc create secret tls example-tls-secret --cert ${PWD}/tls/certificate.pem --key ${PWD}/tls/key.pem -n ${KEYCLOAK_NAMESPACE} || true
}

deploySecrets(){
  cat ${PWD}/auth/database-secrets.yaml \
  | yq '
    .data.username = env(POSTGRES_USER) | 
    .data.password = env(POSTGRES_PASSWORD)
  ' \
  | yq '
    .data.username |= @base64 |
    .data.password |= @base64
  ' \
  | oc apply -f - -n ${KEYCLOAK_NAMESPACE}
}

deployKeyCloak(){
  installKeycloakOperator
  cat ${PWD}/keycloak.yaml \
  | yq ".spec.hostname.hostname = strenv(CERT_HOSTNAME)" \
  | oc apply -f - -n ${KEYCLOAK_NAMESPACE}
}

deleteKeycloakOperator() {
  oc delete subscription rhbk-operator -n "${KEYCLOAK_NAMESPACE}"
  oc delete csv -n "${KEYCLOAK_NAMESPACE}" "$(oc get csv -n "${KEYCLOAK_NAMESPACE}" | grep "${KEYCLOAK_OPERATOR_DISPLAY_NAME}" | awk '{print $1}')"
  oc delete operatorgroup keycloak-operator -n ${KEYCLOAK_NAMESPACE}
}

deleteKeycloak(){
  deleteKeycloakOperator
  oc delete keycloak development-keycloak -n ${KEYCLOAK_NAMESPACE}
}

deleteDB(){
  oc delete statefulset postgresql-db
  oc delete service postgres-db
}

deleteSecrets(){
  oc delete secret keycloak-db-secret
  oc delete secret example-tls-secret
}

deleteAll(){
  deleteSecrets
  deleteDB
  deleteKeycloak
}

deployAll(){
  createProject
  deployTLSKeys
  deploySecrets
  deployDB
  deployKeyCloak
}

DELETE=""
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --generate-certs | -gc)
            # If an optional hostname is provided, use it.
            if [[ -n "$2" ]] && ! [[ "$2" =~ ^- ]]; then
                CERT_HOSTNAME="$2"
                export CERT_HOSTNAME
                shift
            fi

            # Now check if we have a hostname from any source.
            if [[ -z "${CERT_HOSTNAME}" ]]; then
                echo "Error: --generate-certs requires a hostname, either as an argument or in the .env file." >&2
                exit 1
            fi
            echo "Host name is: ${CERT_HOSTNAME}"
            
            # If we have a hostname, generate the certs.
            generateSSLCerts
            ;;
        --namespace | -n)
            KEYCLOAK_NAMESPACE="$2"
            shift
            ;;
        --uninstall)
            DELETE="$2"
            shift
            ;;
        --help | -h)
            usage
            exit 0
            ;;
    esac
    shift
done

case "${DELETE}" in
  "")
    : # noop if $DELETE is empty
    ;;
  keycloak)
    deleteKeyCloak
    exit 0
    ;;
  database)
    deleteDB
    exit 0
    ;;
  secrets)
    deleteSecrets
    exit 0
    ;;
  all)
    deleteAll
    exit 0
    ;;
  *)
    echo "Invalid option, please provide one of: keycloak, database, secrets, all"
    exit 1
    ;;
esac

deployAll
