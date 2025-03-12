# Base image from Microsoft Playwright
# Must stay pinned to a version which includes Nodejs 20
FROM mcr.microsoft.com/playwright:v1.46.1-jammy

ENV CI=1 \
  QT_X11_NO_MITSHM=1 \
  _X11_NO_MITSHM=1 \
  _MITSHM=0 \
  NODE_PATH=/usr/local/lib/node_modules

# Define Helm and OpenShift CLI (oc) versions
ENV HELM_VERSION="v3.12.3"
ENV OC_VERSION="4.14.3"

ARG CI_XBUILD

# should be root user
RUN echo "whoami: $(whoami)" \
  # command "id" should print:
  # uid=0(root) gid=0(root) groups=0(root)
  # which means the current user is root
  && id \
  && npm install -g typescript \
  # give every user read access to the "/root" folder where the binary is cached
  # we really only need to worry about the top folder, fortunately
  && ls -la /root \
  && chmod 755 /root \
  # always grab the latest Yarn
  # otherwise the base image might have old versions
  # NPM does not need to be installed as it is already included with Node.
  && npm i -g yarn@latest \
  # Show where Node loads required modules from
  && node -p 'module.paths'
  # plus Electron and bundled Node versions

RUN  echo  " node version:    $(node -v) \n" \
    "npm version:     $(npm -v) \n" \
    "yarn version:    $(yarn -v) \n" \
    "typescript version:  $(tsc -v) \n" \
    "debian version:  $(cat /etc/debian_version) \n" \
    "user:            $(whoami) \n"

RUN curl -fsSL https://clis.cloud.ibm.com/install/linux | sh && \
    curl -sLO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl && \
    chmod +x kubectl && \
    mv kubectl /usr/local/bin/ && \
    apt-get update -y && \
    apt-get install -y sshpass jq colorized-logs && \
    rm -rf /var/lib/apt/lists/*

# Set Go version and the expected SHA256 hash for verification
ENV GO_VERSION 1.19
ENV GO_SHA256 464b6b66591f6cf055bc5df90a9750bf5fbc9d038722bb84a9d56a2bea974be6

# Install Go and other tools used by the pipeline
RUN apt-get update && \
    apt-get install -y curl && \
    curl -LO "https://golang.org/dl/go${GO_VERSION}.linux-amd64.tar.gz" && \
    echo "${GO_SHA256} go${GO_VERSION}.linux-amd64.tar.gz" | sha256sum -c - && \
    tar -C /usr/local -xzf go${GO_VERSION}.linux-amd64.tar.gz && \
    rm go${GO_VERSION}.linux-amd64.tar.gz && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Install Helm
RUN curl -fsSL -o /tmp/helm.tar.gz "https://get.helm.sh/helm-${HELM_VERSION}-linux-amd64.tar.gz" \
    && tar -xzvf /tmp/helm.tar.gz -C /tmp \
    && mv /tmp/linux-amd64/helm /usr/local/bin/helm \
    && rm -rf /tmp/*

# Install OpenShift CLI (oc)
RUN curl -fsSL -o /tmp/openshift-client-linux.tar.gz "https://mirror.openshift.com/pub/openshift-v4/clients/ocp/${OC_VERSION}/openshift-client-linux-${OC_VERSION}.tar.gz" \
    && tar -xzvf /tmp/openshift-client-linux.tar.gz -C /usr/local/bin oc kubectl \
    && rm -rf /tmp/*

# Install rsync
RUN apt-get update -y && \
    apt-get install -y rsync

# Install yq
RUN wget https://github.com/mikefarah/yq/releases/download/v4.43.1/yq_linux_amd64.tar.gz -O - | tar xz && mv yq_linux_amd64 /usr/bin/yq

# Set environment variables to make Go work correctly
ENV GOPATH /go
ENV PATH $GOPATH/bin:/usr/local/go/bin:$PATH

RUN go install github.com/kadel/pr-commenter@latest && \
    ibmcloud plugin install -f cloud-object-storage && \
    ibmcloud plugin install -f kubernetes-service

WORKDIR /tmp/
