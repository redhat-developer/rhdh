# How to use

## Prerequisites

1.  **yq:** This script requires `yq` (a lightweight and portable command-line YAML processor). Please ensure you have it installed.
    -   **Important:** There are multiple tools named `yq`. This script requires the version from Mike Farah, which can be found here: [https://github.com/mikefarah/yq/](https://github.com/mikefarah/yq/)

2.  **oc CLI:** You must be logged into your OpenShift cluster via the `oc` command-line tool.

## Configuration

This script requires credentials for the PostgreSQL database and a hostname for the Keycloak instance. These can be configured in one of two ways:

1.  **Environment File (Recommended):**
    Copy the `env` template file to `.env` and populate it with your specific values.

    ```bash
    cp env .env
    ```

    Then, edit the `.env` file:

    ```bash
    export CERT_HOSTNAME=keycloak.apps.my-cluster.com
    export POSTGRES_USER=admin
    export POSTGRES_PASSWORD=supersecret
    ```

2.  **Environment Variables:**
    Alternatively, you can export these variables directly in your shell session:

    ```bash
    export CERT_HOSTNAME=keycloak.apps.my-cluster.com
    export POSTGRES_USER=admin
    export POSTGRES_PASSWORD=supersecret
    ```

## Usage

### Install Keycloak

To deploy Keycloak, run the following command. If you have not set the `CERT_HOSTNAME` in the `.env` file, you can provide it as an argument.

```bash
# Using the hostname from the .env file
./deploy-keycloak.sh --generate-certs

# Overriding the hostname with a command-line argument
./deploy-keycloak.sh --generate-certs keycloak.apps.another-cluster.com
```

### Uninstall Keycloak

To remove all the resources created by the script, run:

```bash
./deploy-keycloak.sh --uninstall all
