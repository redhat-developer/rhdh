# syntax=docker/dockerfile:1.14-labs

# THIS IS USED BY Konflux builds == 1.4 - 1.5; see ../.rhdh/docker/Dockerfile for >=1.6
#
# Copyright (c) 2023-2024 Red Hat, Inc.
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

# Stage 1 - Build nodejs skeleton
# https://registry.access.redhat.com/ubi9/nodejs-22
FROM registry.access.redhat.com/ubi9/nodejs-22:9.5-1744136606 AS skeleton
# hadolint ignore=DL3002
USER 0

# Install isolated-vm dependencies
# hadolint ignore=DL3041
RUN dnf install -q -y --allowerasing --nobest \
  nodejs-devel nodejs-libs \
  # already installed or installed as deps:
  openssl openssl-devel ca-certificates make cmake cpp gcc gcc-c++ zlib zlib-devel brotli brotli-devel python3 nodejs-packaging && \
  dnf update -y && dnf clean all

ENV EXTERNAL_SOURCE_NESTED=.
ENV CONTAINER_SOURCE=/opt/app-root/src

# Env vars
ENV YARN=$CONTAINER_SOURCE/.yarn/releases/yarn-3.8.7.cjs

WORKDIR $CONTAINER_SOURCE/
COPY $EXTERNAL_SOURCE_NESTED/.yarn ./.yarn
COPY $EXTERNAL_SOURCE_NESTED/.yarnrc.yml ./

# Add execute permissions to yarn; add yarn to path via symlink
RUN chmod +x "$YARN" && ln -s "$YARN" /usr/local/bin/yarn

# Stage 2 - Install dependencies
FROM skeleton AS deps
COPY $EXTERNAL_SOURCE_NESTED/yarn.lock ./
# BEGIN COPY package.json files
COPY $EXTERNAL_SOURCE_NESTED/plugins/scalprum-backend/package.json ./plugins/scalprum-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/licensed-users-info-backend/package.json ./plugins/licensed-users-info-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info/package.json ./plugins/dynamic-plugins-info/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info-backend/package.json ./plugins/dynamic-plugins-info-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/backend/package.json ./packages/backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/app/package.json ./packages/app/package.json
COPY $EXTERNAL_SOURCE_NESTED/package.json ./package.json
COPY $EXTERNAL_SOURCE_NESTED/e2e-tests/package.json ./e2e-tests/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/_utils/package.json ./dynamic-plugins/_utils/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-utils-dynamic/package.json ./dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-utils-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-http-request-dynamic/package.json ./dynamic-plugins/wrappers/roadiehq-scaffolder-backend-module-http-request-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-scaffolder-backend-argocd-dynamic/package.json ./dynamic-plugins/wrappers/roadiehq-scaffolder-backend-argocd-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-security-insights/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-security-insights/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-jira/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-jira/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-github-pull-requests/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-github-pull-requests/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-github-insights/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-github-insights/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-datadog/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-datadog/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-argo-cd/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-argo-cd/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/roadiehq-backstage-plugin-argo-cd-backend-dynamic/package.json ./dynamic-plugins/wrappers/roadiehq-backstage-plugin-argo-cd-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-marketplace/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-marketplace/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-marketplace-backend-dynamic/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-marketplace-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-global-header/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-global-header/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-global-floating-action-button/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-global-floating-action-button/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-dynamic-home-page/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-dynamic-home-page/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-catalog-backend-module-marketplace-dynamic/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-catalog-backend-module-marketplace-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-bulk-import/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-bulk-import/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-bulk-import-backend-dynamic/package.json ./dynamic-plugins/wrappers/red-hat-developer-hub-backstage-plugin-bulk-import-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/parfuemerie-douglas-scaffolder-backend-module-azure-repositories-dynamic/package.json ./dynamic-plugins/wrappers/parfuemerie-douglas-scaffolder-backend-module-azure-repositories-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/pagerduty-backstage-plugin/package.json ./dynamic-plugins/wrappers/pagerduty-backstage-plugin/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/pagerduty-backstage-plugin-backend-dynamic/package.json ./dynamic-plugins/wrappers/pagerduty-backstage-plugin-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/immobiliarelabs-backstage-plugin-gitlab/package.json ./dynamic-plugins/wrappers/immobiliarelabs-backstage-plugin-gitlab/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/immobiliarelabs-backstage-plugin-gitlab-backend-dynamic/package.json ./dynamic-plugins/wrappers/immobiliarelabs-backstage-plugin-gitlab-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-techdocs/package.json ./dynamic-plugins/wrappers/backstage-plugin-techdocs/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-techdocs-module-addons-contrib/package.json ./dynamic-plugins/wrappers/backstage-plugin-techdocs-module-addons-contrib/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-techdocs-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-techdocs-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-signals/package.json ./dynamic-plugins/wrappers/backstage-plugin-signals/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-signals-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-signals-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-gitlab-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-gitlab-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-github-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-github-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-gerrit-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-gerrit-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-bitbucket-server-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-bitbucket-server-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-bitbucket-cloud-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-bitbucket-cloud-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-azure-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-scaffolder-backend-module-azure-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-notifications/package.json ./dynamic-plugins/wrappers/backstage-plugin-notifications/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-notifications-backend-module-email-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-notifications-backend-module-email-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-notifications-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-notifications-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-kubernetes/package.json ./dynamic-plugins/wrappers/backstage-plugin-kubernetes/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-kubernetes-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-kubernetes-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-msgraph-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-msgraph-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-ldap-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-ldap-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-gitlab-org-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-gitlab-org-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-gitlab-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-gitlab-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-github-org-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-github-org-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-github-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-github-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-bitbucket-server-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-bitbucket-server-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-bitbucket-cloud-dynamic/package.json ./dynamic-plugins/wrappers/backstage-plugin-catalog-backend-module-bitbucket-cloud-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-topology/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-topology/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-tekton/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-tekton/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-tech-radar/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-tech-radar/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-tech-radar-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-tech-radar-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-sonarqube/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-sonarqube/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-sonarqube-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-sonarqube-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-sonarqube-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-sonarqube-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-servicenow-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-servicenow-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-regex-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-regex-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-quay-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-quay-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-kubernetes-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-scaffolder-backend-module-kubernetes-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-redhat-argocd/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-redhat-argocd/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-rbac/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-rbac/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-quay/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-quay/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-ocm/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-ocm/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-ocm-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-ocm-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-nexus-repository-manager/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-nexus-repository-manager/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-lighthouse/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-lighthouse/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-jfrog-artifactory/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-jfrog-artifactory/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-jenkins/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-jenkins/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-jenkins-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-jenkins-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-github-issues/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-github-issues/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-github-actions/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-github-actions/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-dynatrace/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-dynatrace/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-scaffolder-relation-processor-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-scaffolder-relation-processor-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-pingidentity-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-pingidentity-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-keycloak-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-catalog-backend-module-keycloak-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-azure-devops/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-azure-devops/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-azure-devops-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-azure-devops-backend-dynamic/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-analytics-provider-segment/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-analytics-provider-segment/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-acr/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-acr/package.json
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/wrappers/backstage-community-plugin-3scale-backend-dynamic/package.json ./dynamic-plugins/wrappers/backstage-community-plugin-3scale-backend-dynamic/package.json
# END COPY package.json files

# unpack headers from tarball (includes openssl headers not present in /usr/include/node) - see RHIDP-6755 for why we need this upstream
COPY $EXTERNAL_SOURCE_NESTED/.nvm/ .
RUN NODE_HEADERS_VERSION=$(node --version); echo "=== Install node headers $NODE_HEADERS_VERSION from tar.gz ==="; \
  if [[ ! -f releases/node-${NODE_HEADERS_VERSION}-headers.tar.gz ]]; then \
    echo "[ERROR] Base image includes nodejs $NODE_HEADERS_VERSION but could not find releases/node-${NODE_HEADERS_VERSION}-headers.tar.gz to install!"; \
    echo "[ERROR] To fix, upload the node-${NODE_HEADERS_VERSION}-headers.tar.gz file into https://github.com/redhat-developer/rhdh/tree/main/.nvm/releases (or related branch)!"; \
    exit 1; \
  fi; \
  mkdir -p ~/.cache/node-gyp/${NODE_HEADERS_VERSION/v/}; \
  tar -xf releases/node-${NODE_HEADERS_VERSION}-headers.tar.gz --directory ~/.cache/node-gyp/${NODE_HEADERS_VERSION/v/}/ --strip-components 1; \
  echo "11" > ~/.cache/node-gyp/${NODE_HEADERS_VERSION/v/}/installVersion; \
  rm -fr releases/node-${NODE_HEADERS_VERSION}-headers.tar.gz

# Increate timeout for yarn install
RUN "$YARN" config set httpTimeout 600000

RUN echo "=== YARN INSTALL ==="; FAILED=0; "$YARN" install --immutable || true; \
  for d in /tmp/xfs-*; do if [[ -f ${d}/build.log ]]; then \
    (( FAILED = FAILED + 1 )); echo; echo $d; echo "======"; cat ${d}/build.log; \
  fi; done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

# Stage 3 - Build packages
FROM deps AS build

COPY $EXTERNAL_SOURCE_NESTED ./

RUN git config --global --add safe.directory ./
# Upstream only
RUN rm app-config.yaml && mv app-config.example.yaml app-config.yaml

# Downstream only - replace midstream build-metadata.json with the version from downstream (where we include the midstream SHA)
# COPY packages/app/src/build-metadata.json ./packages/app/src/

# hadolint ignore=DL3059,DL4006,SC2086
RUN \
  # Append build time into packages/app/src/build-metadata.json
  now=$(date -u +%FT%TZ); sed -i packages/app/src/build-metadata.json -r \
  -e "s/(\"Last Commit\": \"(.+)\")/\1, \"Build Time\": \"$now\"/" && \
  cat packages/app/src/build-metadata.json; echo

RUN echo "=== YARN BUILD ==="; "$YARN" build --filter=backend

RUN echo "=== EXPORT DYNAMIC PLUGINS ==="; FAILED=0; "$YARN" export-dynamic --filter=./dynamic-plugins/wrappers/* || true; \
for d in /tmp/xfs-*; do if [[ -f ${d}/build.log ]]; then \
  (( FAILED = FAILED + 1 )); echo; echo $d; echo "======"; cat ${d}/build.log; \
fi; done; \
if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

RUN echo "=== YARN COPY DYNAMIC PLUGINS in $(pwd) ==="; "$YARN" copy-dynamic-plugins dist

# Stage 4 - Build the actual backend image and install production dependencies
# Upstream only
FROM skeleton AS cleanup

# Upstream only - copy the install dependencies from the build stage and context
COPY --from=build $CONTAINER_SOURCE/yarn.lock \
  $CONTAINER_SOURCE/package.json \
  ./
COPY --from=build \
  $CONTAINER_SOURCE/packages/backend/dist/skeleton.tar.gz \
  $CONTAINER_SOURCE/packages/backend/dist/bundle.tar.gz \
  ./packages/backend/dist/

# unpack and remove tarballs
ENV TARBALL_PATH=./packages/backend/dist
RUN tar xzf "$TARBALL_PATH"/skeleton.tar.gz; tar xzf "$TARBALL_PATH"/bundle.tar.gz; \
  rm -f "$TARBALL_PATH"/skeleton.tar.gz "$TARBALL_PATH"/bundle.tar.gz

# Copy app-config files needed in runtime
COPY $EXTERNAL_SOURCE_NESTED/app-config*.yaml ./
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins.default.yaml ./

# Hackaround: create library symlinks to build: isolated-vm node-gyp better-sqlite cpu-features
# TODO is this still needed? maintaining it over time will be a chore if the .so files change
RUN echo "=== lib64 symlinks ==="; \
  for l in libbrotlidec.so.1 libbrotlienc.so.1 libbrotlicommon.so.1 libc.so.6 ld-linux-x86-64.so.2 libcrypto.so.3 libk5crypto.so.3 libz.so.1 libssl.so.3; do \
    ln -s /usr/lib64/$l /usr/lib64/${l%.*} 2>/dev/null || true; \
    ls -l /usr/lib64/${l%.*}; \
  done

# Increate timeout for yarn install
RUN "$YARN" config set httpTimeout 600000

# Install production dependencies
# hadolint ignore=DL3059
RUN echo "=== YARN WORKSPACES FOCUS ==="; FAILED=0; "$YARN" workspaces focus --all --production || true; \
  for d in /tmp/xfs-*; do if [[ -f ${d}/build.log ]]; then \
    (( FAILED = FAILED + 1 )); echo; echo $d; echo "======"; cat ${d}/build.log; \
  fi; done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

RUN \
  # delete all the nested .npmrc files and set default values
  find . -type f -name .npmrc -exec rm -Rf {} \; && \
  # reset npm config to the default registry and absolute path to .pem file
  npm config set registry=https://registry.npmjs.org/ && \
  npm config set cafile /opt/app-root/src/registry-ca.pem

# Stage 5 - Build the runner image
# https://registry.access.redhat.com/ubi9/nodejs-22-minimal
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:9.5-1742929466 AS runner
USER 0

ENV EXTERNAL_SOURCE_NESTED=.
ENV CONTAINER_SOURCE=/opt/app-root/src
WORKDIR $CONTAINER_SOURCE/

# Install techdocs dependencies using requirements files
# hadolint ignore=DL3013,DL3041,SC2086
COPY "$EXTERNAL_SOURCE_NESTED"/python/ ./python
RUN microdnf install -y python3.11 python3.11-pip python3.11-devel make cmake cpp gcc gcc-c++ skopeo 1>/dev/null 2>&1; \
  alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
  alternatives --install /usr/bin/pip pip /usr/bin/pip3.11 1 && \
  # fix ownership for pip install folder
  mkdir -p /opt/app-root/src/.cache/pip && chown -R root:root /opt/app-root && \
  # ls -ld /opt/ /opt/app-root /opt/app-root/src/ /opt/app-root/src/.cache /opt/app-root/src/.cache/pip || true; \
  pushd "$EXTERNAL_SOURCE_NESTED"/python/ >/dev/null && \
  set -e; \
  python3.11 -V; pip3.11 -V; \
  pip install --no-cache-dir --upgrade pip setuptools pyyaml; \
  pip install --no-cache-dir -r requirements.txt -r requirements-build.txt; mkdocs --version; \
  popd >/dev/null; \
  rm -fr python/; \
  microdnf clean all

# Upstream only - copy from cleanup stage
COPY --from=cleanup --chown=1001:1001 $CONTAINER_SOURCE/ ./
# Downstream only - copy from build, not cleanup stage
# COPY --from=build --chown=1001:1001 "$CONTAINER_SOURCE"/ ./

# Copy embedded dynamic plugins from $CONTAINER_SOURCE
COPY --from=build $CONTAINER_SOURCE/dynamic-plugins/dist/ ./dynamic-plugins/dist/

# RHIDP-4220 - make Konflux preflight and EC checks happy - [check-container] Create a directory named /licenses and include all relevant licensing
COPY $EXTERNAL_SOURCE/LICENSE /licenses/

# RHIDP-5216/RHIDP-5215 - interim marketplace catalog entities until these data will be loaded from container images
COPY $EXTERNAL_SOURCE/catalog-entities/marketplace /marketplace/catalog-entities/

# Copy script to gather dynamic plugins; copy embedded dynamic plugins to root folder; fix permissions
COPY docker/install-dynamic-plugins.py docker/install-dynamic-plugins.sh ./
RUN chmod -R a+r ./dynamic-plugins/ ./install-dynamic-plugins.py; \
  chmod -R a+rx ./install-dynamic-plugins.sh

# The existence of the index.html.tmpl tells Backstage to take that file and load it into memory, inject the needed appConfig (instead of writing
# it into a random *.chunk.js file, and then serve that file from memory so that we can set the readOnlyRootFilesystem: true option for
# the container.
RUN ln -s /opt/app-root/src/packages/app/dist/index.html /opt/app-root/src/packages/app/dist/index.html.tmpl

# Fix for https://issues.redhat.com/browse/RHIDP-728
RUN mkdir -p /opt/app-root/src/.npm; chown -R 1001:1001 /opt/app-root/src/.npm

# The fix-permissions script is important when operating in environments that dynamically use a random UID at runtime, such as OpenShift.
# The upstream backstage image does not account for this and it causes the container to fail at runtime.
# suppress warnings about dereferencing symlinks
RUN fix-permissions ./ 2>&1 | grep -v "chgrp: cannot dereference" || true

# Switch to nodejs user
USER 1001

# Temporary workaround to avoid triggering issue
# https://github.com/backstage/backstage/issues/20644
ENV CHOKIDAR_USEPOLLING='1' CHOKIDAR_INTERVAL='10000'

# To avoid running scripts when using `npm pack` to install dynamic plugins
ENV NPM_CONFIG_ignore-scripts='true'

# gGVM6sYRK0D0ndVX22BOtS7NRcxPej8t is key for dev environment
# Upstream - Use dev key in all branches
ENV SEGMENT_WRITE_KEY=gGVM6sYRK0D0ndVX22BOtS7NRcxPej8t
ENV SEGMENT_TEST_MODE=false

# RHIDP-2217: corporate proxy support (configured using 'global-agent' for 'node-fetch' calls and 'undici' for 'fetch' calls)
# This is to avoid having to define several environment variables for the same purpose,
# i.e, GLOBAL_AGENT_HTTP(S)_PROXY (for 'global-agent') and the conventional HTTP(S)_PROXY (honored by other libraries like Axios).
# By setting GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE to an empty value,
# 'global-agent' will use the same HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables.
ENV GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=''

# RHDHBUGS-106,RHIDP-4646: requests to the loopback interface should bypass the corporate proxy if set.
# Note that NO_PROXY will take effect only if the 'HTTP(S)_PROXY' environment variables are set.
# Users can still override this when running the image.
ENV NO_PROXY='localhost,127.0.0.1'

# The `--no-node-snapshot` node option enables the usage of the backstage scaffolder on nodejs 20
# https://github.com/backstage/backstage/issues/20661

# Copy instrumentation needed for surfacing metrics
COPY --chown=1001:1001 $EXTERNAL_SOURCE_NESTED/packages/backend/src/instrumentation.js ./
# Remove write and execute permissions
RUN chmod a=r ./instrumentation.js

ENV NODE_OPTIONS="--no-node-snapshot"
ENTRYPOINT ["node", "--require", "./instrumentation.js", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.example.yaml", "--config", "app-config.example.production.yaml"]

# append Brew metadata here
