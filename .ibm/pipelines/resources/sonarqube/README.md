# SonarQube Installation Script

This script installs a SonarQube instance in an OpenShift cluster using the official SonarQube Helm chart.

## Prerequisites

- `kubectl` or `oc` CLI installed and configured to connect to your OpenShift cluster.
- `helm` CLI installed.

## Usage

The `install.sh` script supports the following parameters:

- `--namespace`: The namespace where SonarQube will be installed. (Default: `sonarqube`)
- `--values`: Path to a custom values file for Helm chart customization. (Default: `values.yaml` in the same directory)
- `--edition`: The SonarQube edition to install. (Default: `developer`)
- `--host`: The hostname for the OpenShift route. This is a mandatory parameter.

### Example

```shell
./install.sh --host sonar.<your-cluster-domain>
```

### Example with custom namespace

```shell
./install.sh --namespace my-sonarqube --host sonar.<your-cluster-domain>
```

## Configuration

The script uses a `values.yaml` file to configure the SonarQube Helm chart. You can modify this file to customize your SonarQube installation. For example, you can configure resource limits, persistence, and other chart values.

### External PostgreSQL

By default, the script installs a PostgreSQL database as part of the Helm release. To use an external PostgreSQL database, you can uncomment the following line in the `install.sh` script:

```shell
# HELM_ARGS="${HELM_ARGS} --set postgresql.enabled=false"
```

You will also need to provide the connection details for your external database in the `values.yaml` file.
