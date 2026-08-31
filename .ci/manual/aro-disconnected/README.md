# Manual ARO Disconnected Cluster

These scripts provision an Azure Red Hat OpenShift (ARO) cluster in a disconnected Azure network for
manual RHDH testing. They are not connected to Prow.

The workflow is based on the
[ARO disconnected installation guide](https://github.com/redhat-cop/ocp-disconnected-docs/blob/main/AROInstall.md).
Restricting outbound traffic can violate the ARO support policy; use this workflow only where that
trade-off is understood.

## Prerequisites

- Azure CLI with access to the target subscription
- `ssh-keygen` on the local workstation
- An OpenShift pull secret from <https://console.redhat.com/openshift/install/pull-secret>
- A bastion VM image available in the selected Azure region

## Configuration

Run these commands in this directory:

```bash
cp .env.example .env
```

Edit at least `SUFFIX`, `LOCATION`, and `OPENSHIFT_VERSION`. Place `pull-secret.txt` in this
directory, or set `PULL_SECRET_FILE` to an absolute path. The configuration contains names and
network allow-lists only; it must not contain registry passwords, tokens, or other secret values.

## Workflow

### 1. Create the ARO cluster and bastion

Run on the local workstation:

```bash
./install-aro-disconnected.sh
```

This creates the resource group, VNet, master and worker subnets, Azure Firewall, routes, private
ARO cluster, and bastion VM. The script creates an SSH key pair and writes the SSH command, API
server, console URL, and kubeadmin credentials to a `*_access-information.txt` file with mode
`0600`. The file is ignored by git.

The installer firewall rule is removed after ARO creation. Use the next step to add the outbound
rules needed by the workloads you run.

### 2. Add workload firewall rules

Run on the local workstation:

```bash
./create-azure-firewall-rules.sh
```

The script creates the configured rule collection and adds each rule from its indexed rule list in
order. If the collection already exists, it asks before replacing it.

### 3. Set up the bastion

SSH to the bastion using the protected access information file. Export the two values in the bastion
shell without committing or logging them:

```bash
export API_SERVER='https://...'
export KUBEADMIN_PASSWORD='...'
./setup-bastion.sh
```

The script installs `oc`, Helm, Podman, Skopeo, `opm`, and `umoci`, enables the OpenShift internal
registry, and resizes the bastion partitions.

## Cleanup

When testing is finished, delete the resource group from the local workstation:

```bash
az group delete --name "$RESOURCEGROUP" --yes --no-wait
```

The command reads `RESOURCEGROUP` from the `.env` file if it is sourced in the current shell.
