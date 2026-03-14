# RHDH RHEL 9 Image Mode (bootc + Quadlet)

This directory provides the **Quadlet-ready base image** for deploying Red Hat Developer Hub as a RHEL 9 image-mode appliance (Tech Preview). It is intended as the base image that Ansible (or other installers) can layer onto when producing portal bootc/QCOW images.

## Overview

- **Base**: `registry.redhat.io/rhel9/rhel-bootc:latest`
- **Runtime**: Podman Quadlet manages RHDH and PostgreSQL as systemd services.
- **Air-gap**: Application container images are embedded in the image (no registry pull required at runtime).

## Build

Build on a **RHEL 9 system registered with Red Hat Subscription Management** using Podman. The build container automatically uses the host's subscription.

```bash
# From repo root (on registered RHEL 9)
podman build -f packaging/bootc/Containerfile.bootc -t rhdh-bootc:latest .
```
