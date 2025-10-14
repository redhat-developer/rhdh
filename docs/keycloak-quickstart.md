# Quick Start RHDH

This guide will show you how to quickly start up a quick keycloak instance on Openshift with the [`deploy-keycloak.sh`](https://github.com/redhat-developer/rhdh/blob/main/scripts/keycloak-setup/deploy-keycloak.sh) script.

## Usage

This script allows a quick setup of a basic keycloak instance on OpenShift Container Platform (OCP) clusters for testing purposes.

User should be logged into a cluster to use this script and have the [Red Hat Keycloak Operator installed on the cluster](https://docs.redhat.com/en/documentation/red_hat_build_of_keycloak/26.2/html-single/operator_guide/index#installation-).

This script comes with a few example keycloak resources to be deployed onto the cluster. Please create a `scripts/keycloak-setup/auth/database-secrets.local.yaml` file with your custom database secret, and edit the other resources to fit your needs.

### Options

```bash
./deploy-keycloak.sh [OPTIONS]
```

| Option                                  | Description                                                                                                                         | Default  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------- |
| -gc, --generate-certificates <hostname> | Generates an SSL certificate for the specified hostname. Returns a key.pem and a certificate.pem file in the ${ PWD }/tls directory | N/A      |
| -n, --namespace <namespace>             | The namespace the keycloak resources are installed onto                                                                             | keycloak |
| --uninstall <options>                   | Uninstall specified keycloak resources. Options: database, keycloak, secrets, all                                                   | N/A      |
| -h, --help                              | Prints out the usage instructions                                                                                                   | N/A      |
