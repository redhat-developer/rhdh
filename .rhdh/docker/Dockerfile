# THIS IS USED BY OSBS BUILDS <=1.3
# FOR KONFLUX >=1.4, see ../../docker/Dockerfile
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
#
# To transform into Brew-friendly Dockerfile:
# 1. comment out lines with EXTERNAL_SOURCE_NESTED=. and CONTAINER_SOURCE=/opt/app-root/src
# 2. uncomment lines with EXTERNAL_SOURCE_NESTED and CONTAINER_SOURCE pointing at $REMOTE_SOURCES and $REMOTE_SOURCES_DIR instead (Brew defines these paths)
# 3. uncomment lines with RUN source .../cachito.env
# 4. add Brew metadata

# Stage 1 - Build nodejs skeleton
#@follow_tag(registry.access.redhat.com/ubi9/nodejs-20:1)
# https://registry.access.redhat.com/ubi9/nodejs-20
FROM registry.access.redhat.com/ubi9/nodejs-20:9.5-1743584090 AS build
# hadolint ignore=DL3002
USER 0

# Install isolated-vm dependencies
# hadolint ignore=DL3041
RUN dnf install -y -q --allowerasing --nobest nodejs-devel nodejs-libs \
  # already installed or installed as deps:
  openssl openssl-devel ca-certificates make cmake cpp gcc gcc-c++ zlib zlib-devel brotli brotli-devel python3 nodejs-packaging && \
  dnf update -y && dnf clean all

# Downstream sources
ENV EXTERNAL_SOURCE_NESTED=$REMOTE_SOURCES/upstream1/app/distgit/containers/rhdh-hub
# /remote-source/
ENV CONTAINER_SOURCE=$REMOTE_SOURCES_DIR

# Env vars
ENV YARN=$CONTAINER_SOURCE/.yarn/releases/yarn-3.8.7.cjs

WORKDIR $CONTAINER_SOURCE/
COPY $EXTERNAL_SOURCE_NESTED/.yarn ./.yarn
COPY $EXTERNAL_SOURCE_NESTED/.yarnrc.yml ./

# Add execute permissions to yarn; add yarn to path via symlink
RUN chmod +x "$YARN" && ln -s "$YARN" /usr/local/bin/yarn

# Stage 2 - Install dependencies
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

# Downstream only - debugging
# COPY $REMOTE_SOURCES/ ./
# hadolint ignore=SC2086
# RUN for d in $(find / -name ".npmrc" -o -name ".yarnrc" 2>/dev/null); do echo; echo "==== $d ===="; cat $d; done
# # ls -la ./ upstream1 upstream1/app/ upstream1/app/distgit/containers/ upstream1/app/distgit/containers/rhdh-hub/ || true
# # debug contents of /remote-source/
#  echo "###### /tmp/tls-ca-bundle.pem ######>>"; cat /tmp/tls-ca-bundle.pem; echo "<<###### /tmp/tls-ca-bundle.pem ######"
#  echo "###### $CONTAINER_SOURCE/registry-ca.pem ######>>"; cat $CONTAINER_SOURCE/registry-ca.pem; echo "<<###### $CONTAINER_SOURCE/registry-ca.pem ######"

# Downstream only - Cachito configuration
# see https://docs.engineering.redhat.com/pages/viewpage.action?pageId=228017926#UpstreamSources(Cachito,ContainerFirst)-CachitoIntegrationfornpm
COPY $REMOTE_SOURCES/upstream1/cachito.env \
  $REMOTE_SOURCES/upstream1/app/registry-ca.pem \
  $REMOTE_SOURCES/upstream1/app/distgit/containers/rhdh-hub/.npmrc \
  ./
# registry=https://cachito-nexus.engineering.redhat.com/repository/cachito-yarn-814335/
# email=noreply@domain.local
# always-auth=true
# //cachito-nexus.engineering.redhat.com/repository/cachito-yarn-814335/:_auth=SHA-goes-here==
# fetch-retries=5
# fetch-retry-factor=2
# strict-ssl=true
# cafile="../../../registry-ca.pem"
# NOTE: this is overridden to "/remote-source/registry-ca.pem" below
# hadolint ignore=SC1091,SC2046
RUN \
  # debug
  # cat $CONTAINER_SOURCE/cachito.env; \
  # load envs
  source "$CONTAINER_SOURCE/cachito.env"; \
  \
  # load cert
  cert_path="$CONTAINER_SOURCE/registry-ca.pem"; \
  # debug
  # ls -la "${cert_path}"; \
  npm config set cafile "${cert_path}"; "$YARN" config set cafile "${cert_path}" -g; \
  \
  # set longer timeouts
  # npm config set fetch-retry-maxtimeout 6000000; \
  # npm config set fetch-retry-mintimeout 1000000; \
  # set cachito as default registry
  "$YARN" config set registry $(npm config get registry) -g; \
  \
  # debug
  # ls -l /usr/; \
  # set up node dir with common.gypi and unsafe-perms=true
  ln -s /usr/include/node/common.gypi /usr/common.gypi; "$YARN" config set nodedir /usr; "$YARN" config set unsafe-perm true

# Downstream only - debug
# RUN echo $PATH; ls -la /usr/local/bin/yarn; whereis yarn;which yarn; yarn --version; \
# cat "$CONTAINER_SOURCE"/.npmrc || true; \
# "$YARN" config list --verbose; npm config list; npm config list -l

# Increate timeout for yarn install
RUN "$YARN" config set httpTimeout 600000

RUN "$YARN" install --immutable

# Stage 3 - Build packages
COPY $EXTERNAL_SOURCE_NESTED ./

RUN git config --global --add safe.directory ./
# Upstream only
# RUN rm app-config.yaml && mv app-config.example.yaml app-config.yaml

# Downstream only - replace midstream build-metadata.json with the version from downstream (where we include the midstream SHA)
COPY packages/app/src/build-metadata.json ./packages/app/src/

# hadolint ignore=DL3059,DL4006,SC2086
RUN \
  # Downstream only - relabel upstream + append build time into packages/app/src/build-metadata.json
  now=$(date -u +%FT%TZ); sed -i packages/app/src/build-metadata.json -r \
  -e "s/\"Last Commit: (.+)\"/\"Upstream: \1\", \"Build Time: $now\"/" && \
  cat packages/app/src/build-metadata.json; echo && \
  "$YARN" build --filter=backend && \
  # Downstream only - replace registry refs with cachito ones
  cachitoRegistry=$(npm config get registry); echo "cachito registry: $cachitoRegistry"; \
  for d in $(find . -name yarn.lock); do echo; echo "===== $d ====="; \
  sed -i "$d" -r -e "s#(https://registry.yarnpkg.com|https://registry.npmjs.org)#${cachitoRegistry}#g"; \
  grep resolved "$d" | head -1; echo "Total $(grep resolved $d | wc -l) resolution lines in $d"; \
  done; \
  # Already imported the packages above; need to `yarn install` on the `dist-dynamic` sub-folder for backend plugins
  "$YARN" export-dynamic --filter=./dynamic-plugins/wrappers/* && \
  "$YARN" copy-dynamic-plugins dist

# Downstream only - debug
# hadolint ignore=SC3010,DL4006
RUN echo "=== Check for yarn.lock files that don't use cachito registry ===>"; \
  for d in $(find . -name yarn.lock); do \
  found=$(grep -E "yarnpkg.com|npmjs.org" "$d" | head -1); \
  if [[ "$found" ]]; then echo;echo "$d : $found"; fi; \
  done; \
  echo "<=== Check for yarn.lock files that don't use cachito registry ==="

# Downstream only - clean up dynamic plugins sources:
# Only keep the dist sub-folder in the dynamic-plugins folder
RUN find dynamic-plugins -maxdepth 1 -mindepth 1 -type d -not -name dist -exec rm -Rf {} \;

# Stage 4 - Build the actual backend image and install production dependencies

# Downstream only - files already exist, nothing to copy; next line for debugging only
# RUN ls -l "$CONTAINER_SOURCE"/ "$CONTAINER_SOURCE"/packages/backend/dist/
ENV TARBALL_PATH=./packages/backend/dist

RUN tar xzf "$TARBALL_PATH"/skeleton.tar.gz; tar xzf "$TARBALL_PATH"/bundle.tar.gz; \
  rm -f "$TARBALL_PATH"/skeleton.tar.gz "$TARBALL_PATH"/bundle.tar.gz

# Copy app-config files needed in runtime
# Upstream only
# COPY $EXTERNAL_SOURCE_NESTED/app-config*.yaml ./
# COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins.default.yaml ./

# Install production dependencies
# hadolint ignore=DL3059
RUN "$YARN" workspaces focus --all --production && \
  # delete all the nested .npmrc files and set default values
  find . -type f -name .npmrc -exec rm -Rf {} \; && \
  # reset npm config to the default registry and absolute path to .pem file
  npm config set registry=https://registry.npmjs.org/ && \
  npm config set cafile /opt/app-root/src/registry-ca.pem

# Stage 5 - Build the runner image
#@follow_tag(registry.access.redhat.com/ubi9/nodejs-20-minimal:1)
# https://registry.access.redhat.com/ubi9/nodejs-20-minimal
FROM registry.access.redhat.com/ubi9/nodejs-20-minimal:9.5-1742935170 AS runner
USER 0

# Downstream sources
ENV EXTERNAL_SOURCE_NESTED=$REMOTE_SOURCES/upstream1/app/distgit/containers/rhdh-hub

ENV CONTAINER_SOURCE=/opt/app-root/src
WORKDIR $CONTAINER_SOURCE/

# Downstream only - install techdocs dependencies using cachito sources
COPY $REMOTE_SOURCES/upstream2 $REMOTE_SOURCES_DIR/upstream2/
# hadolint ignore=DL3013,DL3041,SC2086
RUN microdnf update --setopt=install_weak_deps=0 -y && \
  microdnf install -y python3.11 python3.11-pip skopeo && \
  alternatives --install /usr/bin/python python /usr/bin/python3.11 1 && \
  alternatives --install /usr/bin/pip pip /usr/bin/pip3.11 1 && \
  pip install mkdocs-techdocs-core~=1.3.3 && \
  microdnf clean all

# Downstream only - copy from build, not cleanup stage
COPY --from=build --chown=1001:1001 "$REMOTE_SOURCES_DIR"/ ./
# Downstream only - copy embedded dynamic plugins from "$REMOTE_SOURCES_DIR"
COPY --from=build "$REMOTE_SOURCES_DIR"/dynamic-plugins/dist/ ./dynamic-plugins/dist/

# RHIDP-4220 - make Konflux preflight and EC checks happy - [check-container] Create a directory named /licenses and include all relevant licensing
COPY $EXTERNAL_SOURCE/LICENSE /licenses/

# RHIDP-5216/RHIDP-5215 - interim marketplace catalog entities until these data will be loaded from container images
COPY $EXTERNAL_SOURCE/catalog-entities/marketplace /marketplace/catalog-entities/

# Copy script to gather dynamic plugins; copy embedded dynamic plugins to root folder; fix permissions
COPY docker/install-dynamic-plugins.py docker/install-dynamic-plugins.sh ./
RUN chmod -R a+r ./dynamic-plugins/ ./install-dynamic-plugins.py; \
  chmod -R a+rx ./install-dynamic-plugins.sh;

# Downstream only - fix for https://issues.redhat.com/browse/RHIDP-728
RUN mkdir /opt/app-root/src/.npm
RUN chown -R 1001:1001 /opt/app-root/src/.npm

# The existence of the index.html.tmpl tells Backstage to take that file and load it into memory, inject the needed appConfig (instead of writing
# it into a random *.chunk.js file, and then serve that file from memory so that we can set the readOnlyRootFilesystem: true option for
# the container.
RUN ln -s /opt/app-root/src/packages/app/dist/index.html /opt/app-root/src/packages/app/dist/index.html.tmpl

# The fix-permissions script is important when operating in environments that dynamically use a random UID at runtime, such as OpenShift.
# The upstream backstage image does not account for this and it causes the container to fail at runtime.
RUN fix-permissions ./

# Switch to nodejs user
USER 1001

# Temporary workaround to avoid triggering issue
# https://github.com/backstage/backstage/issues/20644
ENV CHOKIDAR_USEPOLLING='1' CHOKIDAR_INTERVAL='10000'

# To avoid running scripts when using `npm pack` to install dynamic plugins
ENV NPM_CONFIG_ignore-scripts='true'

# gGVM6sYRK0D0ndVX22BOtS7NRcxPej8t is key for dev environment
# Use production key in stable release-1.yy branch; use dev key in main for CI/next builds
ENV SEGMENT_WRITE_KEY=mUr49Tkld5bj1lFFPxxqHrAzkQMRINvF
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
