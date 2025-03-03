#
# Copyright (c) 2023 Red Hat, Inc.
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
# https://registry.access.redhat.com/ubi9/nodejs-20
FROM registry.access.redhat.com/ubi9/nodejs-20:9.5-1741006255 AS skeleton
# hadolint ignore=DL3002
USER 0

# Install isolated-vm dependencies
# hadolint ignore=DL3041
RUN dnf install -y -q --allowerasing --nobest nodejs-devel nodejs-libs \
  # already installed or installed as deps:
  openssl openssl-devel ca-certificates make cmake cpp gcc gcc-c++ zlib zlib-devel brotli brotli-devel python3 nodejs-packaging && \
  dnf update -y && dnf clean all

# Upstream sources
ENV EXTERNAL_SOURCE_NESTED=.
ENV CONTAINER_SOURCE=/opt/app-root/src

# Env vars
ENV YARN=$CONTAINER_SOURCE/.yarn/releases/yarn-1.22.19.cjs

WORKDIR $CONTAINER_SOURCE/
COPY $EXTERNAL_SOURCE_NESTED/.yarn ./.yarn
COPY $EXTERNAL_SOURCE_NESTED/.yarnrc.yml ./
RUN chmod +x "$YARN"

# Stage 2 - Install dependencies
FROM skeleton AS deps
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins/ ./dynamic-plugins/
COPY $EXTERNAL_SOURCE_NESTED/package.json $EXTERNAL_SOURCE_NESTED/yarn.lock ./
COPY $EXTERNAL_SOURCE_NESTED/patches/ ./patches/
COPY $EXTERNAL_SOURCE_NESTED/packages/app/package.json ./packages/app/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/backend/package.json ./packages/backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/scalprum-backend/package.json ./plugins/scalprum-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-home-page/package.json ./plugins/dynamic-home-page/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info/package.json ./plugins/dynamic-plugins-info/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info-backend/package.json ./plugins/dynamic-plugins-info-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/auth-backend-module-oidc-provider/package.json ./plugins/auth-backend-module-oidc-provider/package.json
COPY $EXTERNAL_SOURCE_NESTED/plugins/licensed-users-info-backend/package.json ./plugins/licensed-users-info-backend/package.json

RUN "$YARN" install --frozen-lockfile --network-timeout 600000

# Stage 3 - Build packages
# Upstream only
FROM deps AS build

COPY $EXTERNAL_SOURCE_NESTED ./

RUN git config --global --add safe.directory ./
# Upstream only
RUN rm app-config.yaml && mv app-config.example.yaml app-config.yaml

# hadolint ignore=DL3059,DL4006,SC2086
RUN \
  # Upstream only - append build time into packages/app/src/build-metadata.json
  now=$(date -u +%FT%TZ); sed -i packages/app/src/build-metadata.json -r \
    -e "s/(\"Last Commit: .+\")/\1, \"Build Time: $now\"/" && \
  cat packages/app/src/build-metadata.json; echo && \
  "$YARN" build --filter=backend && \
  # Build dynamic plugins: split commands for consistency with downstream
  "$YARN" --cwd ./dynamic-plugins/imports export-dynamic --no-install && \
  # Already imported the packages above; need to `yarn install` on the `dist-dynamic` sub-folder for backend plugins
  "$YARN" --cwd ./dynamic-plugins/imports install-dynamic && \
  "$YARN" export-dynamic -- --filter=./dynamic-plugins/wrappers/* && \
  "$YARN" copy-dynamic-plugins dist

# Stage 4 - Build the actual backend image and install production dependencies
# Upstream only
FROM skeleton AS cleanup

# Upstream only - copy the install dependencies from the build stage and context
COPY --from=build $CONTAINER_SOURCE/yarn.lock \
     $CONTAINER_SOURCE/package.json \
     $CONTAINER_SOURCE/packages/backend/dist/skeleton.tar.gz \
     $CONTAINER_SOURCE/packages/backend/dist/bundle.tar.gz \
     ./
ENV TARBALL_PATH=.

RUN tar xzf "$TARBALL_PATH"/skeleton.tar.gz; tar xzf "$TARBALL_PATH"/bundle.tar.gz; \
  rm -f "$TARBALL_PATH"/skeleton.tar.gz "$TARBALL_PATH"/bundle.tar.gz
COPY $EXTERNAL_SOURCE_NESTED/patches/ ./patches/

# Copy app-config files needed in runtime
# Upstream only
COPY $EXTERNAL_SOURCE_NESTED/app-config*.yaml ./
COPY $EXTERNAL_SOURCE_NESTED/dynamic-plugins.default.yaml ./

# Install production dependencies
# hadolint ignore=DL3059
RUN "$YARN" install --frozen-lockfile --production --network-timeout 600000 && \
    # delete all the nested .npmrc files and set default values
    find . -type f -name .npmrc -exec rm -Rf {} \; && \
    # reset npm config to the default registry and absolute path to .pem file
    npm config set registry=https://registry.npmjs.org/ && \
    npm config set cafile /opt/app-root/src/registry-ca.pem

# Stage 5 - Build the runner image
# https://registry.access.redhat.com/ubi9/nodejs-20-minimal
FROM registry.access.redhat.com/ubi9/nodejs-20-minimal:9.5-1739448741 AS runner
USER 0

# Upstream only
ENV EXTERNAL_SOURCE_NESTED=.

ENV CONTAINER_SOURCE=/opt/app-root/src
WORKDIR $CONTAINER_SOURCE/

# Upstream only - install techdocs dependencies (PyPI source tarballs not required)
# When updating version of mkdocs-techdocs-core remember to update ../.rhdh/docker/requirement* files too
# hadolint ignore=DL3041,DL3042
RUN microdnf update --setopt=install_weak_deps=0 -y && \
  microdnf install -y python3 python3-pip skopeo && \
  pip3 install mkdocs-techdocs-core~=1.3.3 && \
  microdnf clean all

# Upstream only - copy from cleanup stage
COPY --from=cleanup --chown=1001:1001 $CONTAINER_SOURCE/ ./
# Upstream only - copy embedded dynamic plugins from $CONTAINER_SOURCE
COPY --from=build $CONTAINER_SOURCE/dynamic-plugins/dist/ ./dynamic-plugins/dist/

# include patch files in final container just for reference
COPY $EXTERNAL_SOURCE_NESTED/patches/ ./patches/

# Copy script to gather dynamic plugins; copy embedded dynamic plugins to root folder; fix permissions
COPY docker/install-dynamic-plugins.py docker/install-dynamic-plugins.sh ./
RUN chmod -R a+r ./dynamic-plugins/ ./install-dynamic-plugins.py; \
  chmod -R a+rx ./install-dynamic-plugins.sh; \
  rm -fr dynamic-plugins-root && cp -R dynamic-plugins/dist/ dynamic-plugins-root

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
# Upstream only - Use dev key in all branches
ENV SEGMENT_WRITE_KEY=gGVM6sYRK0D0ndVX22BOtS7NRcxPej8t
ENV SEGMENT_TEST_MODE=false

# RHIDP-2217: corporate proxy support (configured using 'global-agent')
# This is to avoid having to define several environment variables for the same purpose,
# i.e, GLOBAL_AGENT_HTTP(S)_PROXY (for 'global-agent') and the conventional HTTP(S)_PROXY (honored by other libraries like Axios).
# By setting GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE to an empty value,
# 'global-agent' will use the same HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables.
ENV GLOBAL_AGENT_ENVIRONMENT_VARIABLE_NAMESPACE=''

# The `--no-node-snapshot` node option enables the usage of the backstage scaffolder on nodejs 20
# https://github.com/backstage/backstage/issues/20661

ENTRYPOINT ["node", "packages/backend", "--no-node-snapshot", "--config", "app-config.yaml", "--config", "app-config.example.yaml", "--config", "app-config.example.production.yaml"]

# append Brew metadata here
