# Quick Start RHDH

This guide will show you how to quickly start up a customized instance of RHDH using Helm with the[`quick-start-rhdh.sh`](https://github.com/redhat-developer/rhdh/blob/main/scripts/rhdh-openshift-setup/quick-start-rhdh.sh) script.

## Usage

This script simplifies and automates the installation process of Helm charts on OpenShift Container Platform (OCP) clusters.

User should be logged into a cluster to use this script. Please provide your secret file in the form of 'rhdh-secrets.local.yaml' in the `scripts/rhdh-openshift-setup/auth` directory.

This script comes with a few example kubernetes resources to be deployed alongside the helm chart for configurations, and testing backstage plugins that rely on kubernetes resources such as the topology, tekton, and kubernetes plugins.

### Options

```bash
./quick-start-rhdh.sh [OPTIONS]
```

| Option                           | Description                                                                                                                                                           | Default                                         | Arguments                               |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------- |
| -n, --namespace <namespace>      | Specify the namespace for the Helm release.                                                                                                                           | `rhdh`                                          | N/A                                     |
| --router-base <router-base>      | Manually provide the cluster router base for the helm deployment to use. Autodetects if not provided.                                                                 | N/A                                             | N/A                                     |
| --release-name <name>            | Specify a custom release name for the Helm chart. Auto-generates if not provided, which will always generate a new helm release instead of upgrading an existing one. | N/A                                             | N/A                                     |
| --values <file>                  | Specify your own values file for the Helm chart. Default: 'values.yaml' in the script's current directory.                                                            | `values.yaml`                                   | N/A                                     |
| --uninstall <option>             | Uninstall the Helm chart and/or Kubernetes resources.                                                                                                                 | N/A                                             | all, helm, configs, kubernetes          |
| --kubernetes-resources <options> | Deploy Kubernetes resources.                                                                                                                                          | N/A                                             | serviceaccount, topology-resources, all |
| --helm-repo-url <url>            | Specify the URL of the Helm repository to install.                                                                                                                    | <https://redhat-developer.github.io/rhdh-chart> | N/A                                     |
| --helm-repo-name <name>          | Specify the name of the Helm repository to install and use.                                                                                                           | rhdh-chart                                      | N/A                                     |
| --helm-chart-name <name>         | Specify the name of the Helm chart in the helm repository                                                                                                             | backstage                                       | N/A                                     |
| -h, --help                       | Displays usage instructions and exit.                                                                                                                                 | N/A                                             | N/A                                     |
