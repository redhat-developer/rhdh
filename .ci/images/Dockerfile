# Base image from Microsoft Playwright (multi-arch: amd64 + arm64)
# Playwright v1.61.1-noble includes Node 24.14.1
# Pinned to manifest list digest to support both platforms
FROM mcr.microsoft.com/playwright:v1.61.1-noble@sha256:5b8f294aff9041b7191c34a4bab3ac270157a28774d4b0660e9743297b697e48

# Automatically set by buildx/podman based on --platform (amd64 or arm64)
ARG TARGETARCH

# Set environment variables for the container
ENV CI=1 \
    QT_X11_NO_MITSHM=1 \
    _X11_NO_MITSHM=1 \
    _MITSHM=0 \
    NODE_PATH=/usr/local/lib/node_modules \
    HELM_VERSION="v3.17.2" \
    OC_VERSION="4.22.3" \
    OCM_VERSION="0.1.76" \
    UMOCI_VERSION="v0.6.0"

# Copy Yarn configuration files to correctly use the project-defined Yarn version
COPY .yarn /root/.yarn
COPY .yarnrc.yml /root/.yarnrc.yml
RUN rm -f $(which yarn) || true

# Extract the correct version from the file and install
RUN YARN_VERSION=$(awk -F'[-.]' '/yarnPath:/ {print $(NF-3)"."$(NF-2)"."$(NF-1)}' /root/.yarnrc.yml) && \
  echo "Detected Yarn Version: $YARN_VERSION" && \
  corepack enable && \
  corepack prepare "yarn@$YARN_VERSION" --activate && \
  yarn -v && \
  rm -f /root/.yarnrc.yml && \
  echo "export PATH=\"\$HOME/.yarn/bin:\$HOME/.config/yarn/global/node_modules/.bin:\$PATH\"" >> /root/.bashrc && \
  echo 'echo "Yarn version: $(yarn -v)"' >> /root/.bashrc

# Install essential dependencies and Node.js tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    make gcc g++ python3 rsync sshpass \
    nodejs \
    openssl libssl-dev ca-certificates \
    apache2-utils \
    gettext \
    curl wget jq colorized-logs \
    unzip dnsutils && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/* && \
    echo "Node: $(node -v)\nNPM: $(npm -v)\nYarn: $(yarn -v)\nTypeScript: $(tsc -v)"

# Ensure the current user is root and verify permissions
RUN echo "whoami: $(whoami)" && \
    # The "id" command should confirm the user is root
    id && \
    # Make the "/root" folder readable for all users
    chmod 755 /root && \
    # Check where Node.js loads required modules
    node -p 'module.paths'

# Install Helm, OpenShift CLI, oc-mirror, ocm-cli, and yq
# OC client: amd64 has no arch suffix (default), arm64 needs "-arm64".
# oc-mirror: arm64 lives under "openshift-v4/aarch64/" mirror tree.
RUN OC_ARCH_SUFFIX=$([ "${TARGETARCH}" = "arm64" ] && echo "-arm64" || echo "") && \
    OC_MIRROR_TREE=$([ "${TARGETARCH}" = "arm64" ] && echo "openshift-v4/aarch64" || echo "openshift-v4") && \
    curl -fsSL -o /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-${TARGETARCH}.tar.gz" && \
    tar -xzvf /tmp/helm.tar.gz -C /tmp && mv /tmp/linux-${TARGETARCH}/helm /usr/local/bin/helm && \
    curl -fsSL -o /tmp/openshift-client-linux.tar.gz "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${OC_VERSION}/openshift-client-linux${OC_ARCH_SUFFIX}-${OC_VERSION}.tar.gz" && \
    tar -xzvf /tmp/openshift-client-linux.tar.gz -C /usr/local/bin oc kubectl && \
    curl -fsSL -o /tmp/oc-mirror.tar.gz "https://mirror.openshift.com/pub/${OC_MIRROR_TREE}/clients/ocp/${OC_VERSION}/oc-mirror.tar.gz" && \
    tar -xzvf /tmp/oc-mirror.tar.gz -C /usr/local/bin oc-mirror && \
    chmod +x /usr/local/bin/oc-mirror && \
    curl -Lo /usr/local/bin/ocm "https://github.com/openshift-online/ocm-cli/releases/download/v${OCM_VERSION}/ocm-linux-${TARGETARCH}" && \
    chmod +x /usr/local/bin/ocm && \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/v4.43.1/yq_linux_${TARGETARCH}.tar.gz" | tar -xz && \
    mv yq_linux_${TARGETARCH} /usr/local/bin/yq && \
    rm -rf /tmp/* /var/tmp/*

# Install Azure CLI
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install Google Cloud CLI
RUN echo "deb [signed-by=/usr/share/keyrings/cloud.google.gpg] https://packages.cloud.google.com/apt cloud-sdk main" | tee -a /etc/apt/sources.list.d/google-cloud-sdk.list && \
    curl https://packages.cloud.google.com/apt/doc/apt-key.gpg | gpg --dearmor -o /usr/share/keyrings/cloud.google.gpg && \
    apt-get update -y && \
    apt-get install google-cloud-cli google-cloud-sdk-gke-gcloud-auth-plugin -y && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install AWS CLI (uname -m returns x86_64 on amd64, aarch64 on arm64 — matching AWS URL naming)
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install && \
    rm -rf awscliv2.zip aws/

# Install skopeo and podman
RUN apt-get update -y && \
    apt-get install -y --no-install-recommends skopeo podman

# Install PostgreSQL CLI (psql only)
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install umoci (v0.6.0+ provides multi-arch binaries)
RUN curl -LO "https://github.com/opencontainers/umoci/releases/download/${UMOCI_VERSION}/umoci.linux.${TARGETARCH}" && \
    chmod +x "umoci.linux.${TARGETARCH}" && \
    mv "umoci.linux.${TARGETARCH}" /usr/local/bin/umoci

# Install opm
RUN curl -LO "https://github.com/operator-framework/operator-registry/releases/download/v1.47.0/linux-${TARGETARCH}-opm" && \
    chmod +x "linux-${TARGETARCH}-opm" && \
    mv "linux-${TARGETARCH}-opm" /usr/local/bin/opm

# Install Operator SDK CLI (required to install OLM on K8s clusters)
RUN export ARCH=$(case $(uname -m) in x86_64) echo -n amd64 ;; aarch64) echo -n arm64 ;; *) echo -n $(uname -m) ;; esac) && \
    export OS=$(uname | awk '{print tolower($0)}') && \
    curl -LO "https://github.com/operator-framework/operator-sdk/releases/download/v1.39.1/operator-sdk_${OS}_${ARCH}" && \
    chmod +x operator-sdk_${OS}_${ARCH} && mv operator-sdk_${OS}_${ARCH} /usr/local/bin/operator-sdk

# Set working directory
WORKDIR /tmp/
