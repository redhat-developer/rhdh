#!/bin/bash
# Guide: https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/22.0/html-single/operator_guide/index#basic-deployment-database
# Prerequisite: Install Keycloak Operator (https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.2/html-single/operator_guide/index#installation-)

set -e

KEYCLOAK_NAMESPACE=keycloak
CERT_HOSTNAME="" # Ex: keycloak.apps-crc.testing
DELETE=false

# TODO: add method to deploy without operator for ARM systems that don't have access to the keycloak operator.
usage() {
  echo "
This script uses the Red Hat Keycloak operator to quickly setup an instance of keycloak with TLS enabled and a persistent postgresql database on Openshift Container Platform (OCP).
Prerequisites:
  - Keycloak Operator needs to be installed on the cluster (https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.2/html-single/operator_guide/index#installation-)
  - Be logged in to the cluster on the CLI
Usage:
  $0 [OPTIONS]

OPTIONS:
  -gc,  --generate-certificates <hostname> : Generates an SSL certificate for the specified hostname. Returns a key.pem and a certificate.pem file in the ${PWD}/tls directory
  -n,   --namespace <namespace>            : The namespace the keycloak resources are installed onto. Default: keycloak
        --uninstall <options>              : Uninstall specified keycloak resources. Options:  database, keycloak, secrets, all
  -h,   --help                             : Prints this help message and exits

"
}
PWD="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
echo "${PWD}"

deployDB(){
  oc apply -f ${PWD}/database/postgres.yaml -n ${KEYCLOAK_NAMESPACE}
}

generateSSLCerts(){
  openssl req -subj "/CN=${CERT_HOSTNAME}/O=RHDH/C=CA" -newkey rsa:2048 -nodes -keyout "${PWD}/tls/key.pem" -x509 -days 365 -out "${PWD}/tls/" certificate.pem -addext "subjectAltName = DNS:${CERT_HOSTNAME}"
}
deployTLSKeys(){
  oc create secret tls example-tls-secret --cert ${PWD}/tls/certificate.pem --key ${PWD}/tls/key.pem -n ${KEYCLOAK_NAMESPACE}
}

deploySecrets(){
  oc apply -f ${PWD}/auth/database-secrets.local.yaml -n ${KEYCLOAK_NAMESPACE}
}

deployKeyCloak(){
  oc apply -f ${PWD}/keycloak.yaml -n ${KEYCLOAK_NAMESPACE}
}

deleteKeyCloak(){
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
  deleteKeyCloak
}

deployAll(){
  deployTLSKeys
  deploySecrets
  deployDB
  deployKeyCloak
}

while [[ "$#" -gt 0 ]]; do
    case $1 in
        --generate-certs | -gc)
            CERT_HOSTNAME="$2"
            shift
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

# Create Namespace and switch to it
oc new-project ${KEYCLOAK_NAMESPACE}
if [ $? -ne 0 ]; then
  # Switch to it if it already exists
  oc project ${KEYCLOAK_NAMESPACE}
fi

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

if [[ -n "${CERT_HOSTNAME}" ]]; then
  generateSSLCerts
else
  echo "Please provide a valid hostname for the SSL certificate"
  exit 1
fi

deployAll
