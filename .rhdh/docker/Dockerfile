# THIS IS USED BY Konflux builds >= 1.6
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
FROM registry.access.redhat.com/ubi9/nodejs-22:9.6-1761057796 AS skeleton
# hadolint ignore=DL3002
USER 0

# Install isolated-vm dependencies
# hadolint ignore=DL3041
RUN dnf install -q -y --allowerasing --nobest \
  acl alternatives attr audit-libs basesystem bash binutils binutils-gold brotli brotli-devel bsdtar bzip2-libs ca-certificates cmake containers-common coreutils-single cpp \
  cracklib cracklib-dicts criu criu-libs crun crypto-policies crypto-policies-scripts curl-minimal cyrus-sasl-lib dbus dbus-broker dbus-common dbus-libs dejavu-sans-fonts \
  dmidecode dnf dnf-data elfutils-debuginfod-client elfutils-default-yama-scope elfutils-libelf elfutils-libs emacs-filesystem environment-modules expat file-libs filesystem \
  findutils fonts-filesystem fuse-common fuse-overlayfs fuse3 fuse3-libs gawk gcc gcc-c++ gdb-gdbserver gdbm-libs gettext gettext-libs git git-core git-core-doc glib2 glibc \
  glibc-common glibc-devel glibc-headers glibc-langpack-en glibc-locale-source glibc-minimal-langpack gmp gnupg2 gnutls gobject-introspection gpgme grep groff-base gzip \
  ima-evm-utils iproute json-c json-glib kernel-headers keyutils keyutils-libs kmod kmod-libs krb5-libs langpacks-core-en langpacks-core-font-en langpacks-en less \
  libacl libarchive libassuan libattr libblkid libbpf libbrotli libcap libcap-ng libcbor libcom_err libcomps libcurl-minimal libdb libdnf libdnf-plugin-subscription-manager \
  libeconf libedit libevent libfdisk libffi libfido2 libgcc libgcrypt libgomp libgpg-error libidn2 libksba libmnl libmodulemd libmount libmpc libnet libnghttp2 libnl3 \
  libpipeline libpkgconf libpwquality librepo libreport-filesystem librhsm libseccomp libselinux libsemanage libsepol libsigsegv libslirp libsmartcols libsolv libstdc++ libstdc++-devel \
  libtasn1 libunistring libuser libutempter libuuid libverto libxcrypt libxcrypt-compat libxcrypt-devel libxml2 libyaml libzstd lua-libs lz4-libs make man mpfr \
  ncurses ncurses-base ncurses-libs nettle npth nss_wrapper-libs openldap \
  openssh openssh-clients openssl openssl-devel openssl-fips-provider openssl-fips-provider-so openssl-libs p11-kit p11-kit-trust pam passwd pcre pcre2 pcre2-syntax \
  perl perl-AutoLoader perl-B perl-base perl-Carp perl-Class-Struct perl-constant perl-Data-Dumper perl-Digest perl-Digest-MD5 perl-DynaLoader perl-Encode perl-Errno perl-Error \
  perl-Exporter perl-Fcntl perl-File-Basename perl-File-Find perl-File-Path perl-File-stat perl-File-Temp perl-FileHandle perl-Getopt-Long perl-Getopt-Std perl-Git perl-HTTP-Tiny \
  perl-interpreter perl-IO perl-IO-Socket-IP perl-IO-Socket-SSL perl-IPC-Open3 perl-lib perl-libnet perl-libs perl-MIME-Base64 perl-Mozilla-CA perl-mro perl-NDBM_File perl-Net-SSLeay \
  perl-overload perl-overloading perl-parent perl-PathTools perl-Pod-Escapes perl-Pod-Perldoc perl-Pod-Simple perl-Pod-Usage perl-podlators perl-POSIX perl-Scalar-List-Utils perl-SelectSaver \
  perl-Socket perl-Storable perl-subs perl-Symbol perl-Term-ANSIColor perl-Term-Cap perl-TermReadKey perl-Text-ParseWords perl-Text-Tabs+Wrap perl-Time-Local perl-URI perl-vars pkgconf \
  pkgconf-m4 pkgconf-pkg-config popt procps-ng protobuf-c psmisc python-unversioned-command python3 python3-chardet python3-cloud-what python3-dateutil python3-dbus python3-decorator \
  python3-dnf python3-dnf-plugins-core python3-gobject-base python3-gobject-base-noarch python3-gpg python3-hawkey python3-idna python3-iniparse python3-inotify python3-libcomps \
  python3-libdnf python3-librepo python3-libs python3-pip python3-pip-wheel python3-pysocks python3-requests python3-rpm python3-setuptools python3-setuptools-wheel python3-six \
  python3-subscription-manager-rhsm python3-systemd python3-urllib3 readline redhat-release rootfiles rpm rpm-build-libs rpm-libs rpm-plugin-selinux rpm-sign-libs rsync scl-utils \
  sed selinux-policy selinux-policy-targeted setup shadow-utils skopeo slirp4netns sqlite-libs subscription-manager subscription-manager-rhsm-certificates systemd systemd-libs \
  systemd-pam systemd-rpm-macros tar tcl tpm2-tss tzdata unzip usermode util-linux util-linux-core vim-filesystem vim-minimal virt-what which xz xz-libs yajl yum zlib zlib-devel && \
  \
  # '(micro)dnf update -y' not allowed in Konflux+Cachi2: instead use renovate or https://github.com/konflux-ci/rpm-lockfile-prototype to update the rpms.lock.yaml file
  dnf clean all

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
COPY $EXTERNAL_SOURCE_NESTED/plugins/dynamic-plugins-info-backend/package.json ./plugins/dynamic-plugins-info-backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/theme-wrapper/package.json ./packages/theme-wrapper/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/plugin-utils/package.json ./packages/plugin-utils/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/backend/package.json ./packages/backend/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/app/package.json ./packages/app/package.json
COPY $EXTERNAL_SOURCE_NESTED/packages/app-next/package.json ./packages/app-next/package.json
COPY $EXTERNAL_SOURCE_NESTED/package.json ./package.json
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

# Increase timeout for yarn install
RUN "$YARN" config set httpTimeout 600000

# Using cachi2 env vars:
#   export YARN_ENABLE_GLOBAL_CACHE=false
#   export YARN_ENABLE_IMMUTABLE_CACHE=false
#   export YARN_ENABLE_MIRROR=true
#   export YARN_GLOBAL_FOLDER=/cachi2/output/deps/yarn
RUN cat /cachi2/cachi2.env; echo; find /cachi2/output/deps/yarn/*

RUN echo "=== YARN INSTALL ==="; FAILED=0; "$YARN" install --immutable || FAILED=1; \
  for d in /tmp/xfs-*; do if [[ -f ${d}/build.log ]]; then \
  (( FAILED = FAILED + 1 )); \
  echo; echo $d; \
  echo "!!! YARN INSTALL FAILED !!!"; \
  cat ${d}/build.log; \
  fi; done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

# Stage 3 - Build packages
FROM deps AS build

COPY $EXTERNAL_SOURCE_NESTED ./

# Explicitly disable networking + use local cache:
RUN echo "=== TWEAK .yarnrc.yml ==="; \
  echo "enableNetwork: false" >> .yarnrc.yml && \
  echo "cacheFolder: $YARN_GLOBAL_FOLDER" >> .yarnrc.yml && \
  echo "Current .yarnrc.yml" && \
  cat .yarnrc.yml

RUN git config --global --add safe.directory ./
# Upstream only
# RUN rm app-config.yaml && mv app-config.example.yaml app-config.yaml

# Downstream only - replace midstream build-metadata.json with the version from downstream (where we include the midstream SHA)
COPY packages/app/src/build-metadata.json ./packages/app/src/

# hadolint ignore=DL3059,DL4006,SC2086
RUN \
  # Append build time into packages/app/src/build-metadata.json
  now=$(date -u +%FT%TZ); sed -i packages/app/src/build-metadata.json -r \
  -e "s/(\"Last Commit\": \"(.+)\")/\1, \"Build Time\": \"$now\"/" && \
  cat packages/app/src/build-metadata.json; echo

# suppress git warnings about dubious ownership in repository at '/opt/app-root/src' when building
RUN echo "=== YARN BUILD ==="; FAILED=0; \
  git config --global --add safe.directory /opt/app-root/src; \
  "$YARN" build || FAILED=1; \
  for d in $(find . -name yarn-install.log); do \
  (( FAILED = FAILED + 1 )); echo; echo $d; echo "======"; cat ${d}; \
  done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

WORKDIR $CONTAINER_SOURCE/dynamic-plugins

RUN echo "=== DYNAMIC PLUGIN YARN INSTALL ==="; FAILED=0; "$YARN" install --immutable || FAILED=1; \
  for d in /tmp/xfs-*; do if [[ -f ${d}/build.log ]]; then \
  (( FAILED = FAILED + 1 )); \
  echo; echo $d; \
  echo "!!! DYNAMIC PLUGIN YARN INSTALL FAILED !!!"; \
  cat ${d}/build.log; \
  fi; done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

RUN echo "=== EXPORT DYNAMIC PLUGINS ==="; FAILED=0; \
  "$YARN" export-dynamic || FAILED=1; \
  for d in $(find . -name yarn-install.log); do \
  (( FAILED = FAILED + 1 )); echo; echo $d; echo "======"; cat ${d}; \
  done; \
  if [[ $FAILED -gt 0 ]]; then exit $FAILED; fi

RUN echo "=== YARN COPY DYNAMIC PLUGINS in $(pwd) ==="; "$YARN" copy-dynamic-plugins dist

WORKDIR $CONTAINER_SOURCE

# Downstream only - clean up dynamic plugins sources:
# Only keep the dist sub-folder in the dynamic-plugins folder
RUN echo "=== DELETE DYNAMIC PLUGINS/* (except dist/) from $(pwd) ==="; find dynamic-plugins -maxdepth 1 -mindepth 1 -type d -not -name dist -exec rm -Rf {} \;

# Stage 4 - Build the actual backend image and install production dependencies
# Upstream only
# FROM skeleton AS cleanup

# Upstream only - copy the install dependencies from the build stage and context
# COPY --from=build $CONTAINER_SOURCE/yarn.lock \
#   $CONTAINER_SOURCE/package.json \
#   ./
# COPY --from=build \
#   $CONTAINER_SOURCE/packages/backend/dist/skeleton.tar.gz \
#   $CONTAINER_SOURCE/packages/backend/dist/bundle.tar.gz \
#   ./packages/backend/dist/

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

# Increase timeout for yarn install
RUN "$YARN" config set httpTimeout 600000

# Install production dependencies
# hadolint ignore=DL3059
RUN echo "=== YARN WORKSPACES FOCUS ==="; FAILED=0; "$YARN" workspaces focus --all --production || FAILED=1; \
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

# dump console logs if they have errors
RUN hadFail=0; for d in $(find /tmp -name "yarn*log*" || true) $(find /tmp/xfs-*  -name build.log || true); do \
  failsCheck="$(grep -E "Failed with errors|Failed to execute command|Failed to install|Failed to download|exit code 1" "$d")"; \
  if [[ $failsCheck != "" ]]; then \
  echo "==== $d SUMMARY ===="; echo "$failsCheck"; \
  echo "==== $d FULL ====";    cat "$d"; echo "==== $d ===="; \
  (( hadFail = hadFail +1 )); \
  fi; \
  done; if [[ $hadFail -gt 0 ]]; then exit $hadFail; fi

# Stage 5 - Build the runner image
# https://registry.access.redhat.com/ubi9/nodejs-22-minimal
FROM registry.access.redhat.com/ubi9/nodejs-22-minimal:9.6-1760544659 AS runner
USER 0

ENV EXTERNAL_SOURCE_NESTED=.
ENV CONTAINER_SOURCE=/opt/app-root/src
WORKDIR $CONTAINER_SOURCE/

# cachi2 env vars:
#   export PIP_FIND_LINKS=/cachi2/output/deps/pip
#   export PIP_NO_INDEX=true

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
# COPY --from=cleanup --chown=1001:1001 $CONTAINER_SOURCE/ ./
# Downstream only - copy from build, not cleanup stage
COPY --from=build --chown=1001:1001 "$CONTAINER_SOURCE"/ ./

# RHIDP-4220 - make Konflux preflight and EC checks happy - [check-container] Create a directory named /licenses and include all relevant licensing
COPY $EXTERNAL_SOURCE_NESTED/LICENSE /licenses/

# RHIDP-5216/RHIDP-5215 - interim marketplace catalog entities until these data will be loaded from container images
COPY $EXTERNAL_SOURCE_NESTED/catalog-entities/marketplace /marketplace/catalog-entities/

# Copy script to gather dynamic plugins; copy embedded dynamic plugins to root folder; fix permissions
COPY $EXTERNAL_SOURCE_NESTED/docker/install-dynamic-plugins.py $EXTERNAL_SOURCE_NESTED/docker/install-dynamic-plugins.sh ./
RUN chmod -R a+rx ./install-dynamic-plugins.*

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
# Use production key in stable release-1.yy branch; use dev key in main for CI/next builds
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
