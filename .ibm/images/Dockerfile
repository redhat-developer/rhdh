# Base image from Microsoft Playwright
# Must stay pinned to a version which includes Nodejs 22
FROM mcr.microsoft.com/playwright:v1.56.0-jammy

# Set environment variables for the container
ENV CI=1 \
    QT_X11_NO_MITSHM=1 \
    _X11_NO_MITSHM=1 \
    _MITSHM=0 \
    NODE_PATH=/usr/local/lib/node_modules \
    HELM_VERSION="v3.17.2" \
    OC_VERSION="4.19.17" \
    OCM_VERSION="0.1.76" \
    GO_VERSION="1.19" \
    GO_SHA256="464b6b66591f6cf055bc5df90a9750bf5fbc9d038722bb84a9d56a2bea974be6" \
    GOPATH="/go" \
    PATH="$GOPATH/bin:/usr/local/go/bin:$PATH"

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

# Install Helm, OpenShift CLI, ocm-cli, and yq
RUN curl -fsSL -o /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" && \
    tar -xzvf /tmp/helm.tar.gz -C /tmp && mv /tmp/linux-amd64/helm /usr/local/bin/helm && \
    curl -fsSL -o /tmp/openshift-client-linux.tar.gz "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${OC_VERSION}/openshift-client-linux-${OC_VERSION}.tar.gz" && \
    tar -xzvf /tmp/openshift-client-linux.tar.gz -C /usr/local/bin oc kubectl && \
    curl -Lo /usr/local/bin/ocm "https://github.com/openshift-online/ocm-cli/releases/download/v${OCM_VERSION}/ocm-linux-amd64" && \
    chmod +x /usr/local/bin/ocm && \
    curl -fsSL "https://github.com/mikefarah/yq/releases/download/v4.43.1/yq_linux_amd64.tar.gz" | tar -xz && \
    mv yq_linux_amd64 /usr/local/bin/yq && \
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

# Install AWS CLI
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" && \
    unzip awscliv2.zip && \
    ./aws/install

# Install skopeo
RUN apt-get update -y && \
    apt-get install -y skopeo

# Install PostgreSQL CLI (psql only)
RUN apt-get update && \
    apt-get install -y --no-install-recommends postgresql-client && \
    rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Install umoci
RUN curl -LO "https://github.com/opencontainers/umoci/releases/download/v0.4.7/umoci.amd64" && \
    chmod +x umoci.amd64 && \
    mv umoci.amd64 /usr/local/bin/umoci

# Install opm
RUN curl -LO "https://github.com/operator-framework/operator-registry/releases/download/v1.47.0/linux-amd64-opm" && \
    chmod +x linux-amd64-opm && \
    mv linux-amd64-opm /usr/local/bin/opm

# Install Operator SDK CLI (required to install OLM on K8s clusters)
RUN export ARCH=$(case $(uname -m) in x86_64) echo -n amd64 ;; aarch64) echo -n arm64 ;; *) echo -n $(uname -m) ;; esac) && \
    export OS=$(uname | awk '{print tolower($0)}') && \
    curl -LO "https://github.com/operator-framework/operator-sdk/releases/download/v1.39.1/operator-sdk_${OS}_${ARCH}" && \
    chmod +x operator-sdk_${OS}_${ARCH} && mv operator-sdk_${OS}_${ARCH} /usr/local/bin/operator-sdk

# Set working directory
WORKDIR /tmp/
