#!/bin/bash

# shellcheck source=.ci/pipelines/lib/log.sh
source "$DIR"/lib/log.sh
# shellcheck source=.ci/pipelines/lib/common.sh
source "$DIR"/lib/common.sh
# shellcheck source=.ci/pipelines/utils.sh
source "$DIR"/utils.sh
# shellcheck source=.ci/pipelines/install-methods/operator.sh
source "$DIR"/install-methods/operator.sh
# shellcheck source=.ci/pipelines/lib/testing.sh
source "$DIR"/lib/testing.sh
# shellcheck source=.ci/pipelines/playwright-projects.sh
source "$DIR"/playwright-projects.sh
# shellcheck source=.ci/pipelines/lib/disconnected.sh
source "$DIR"/lib/disconnected.sh

export INSTALL_METHOD="operator"

handle_ocp_disconnected_operator() {
  # Force a dedicated namespace (env_variables.sh may already set NAME_SPACE=showcase).
  export NAME_SPACE="showcase-disconnected"

  common::oc_login

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::setup_local_ocp_mirror || return 1
  fi

  disconnected::require_env
  disconnected::setup_auth

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  # Uses prepare-restricted-environment.sh from rhdh-operator, which handles
  # mirroring operator/operand images and installing the operator CatalogSource.
  log::section "Operator Mirroring and Installation"

  local prepare_script_path="${DISCONNECTED_TMPDIR}/prepare-restricted-environment.sh"
  local prepare_script_commit="d4c08b8498b3e6c55076b427db65048877e27234"
  local prepare_script_url="https://raw.githubusercontent.com/Fortune-Ndlovu/rhdh-operator/d4c08b8498b3e6c55076b427db65048877e27234/.rhdh/scripts/prepare-restricted-environment.sh"
  local expected_prepare_script_checksum="0094cb0e353258fdb7f5269c2548cd8cb510106cad4d96a70918e5a40c8153cb"
  local actual_prepare_script_checksum

  if ! curl -fsSL --max-time 30 -o "${prepare_script_path}" "${prepare_script_url}"; then
    log::error "Failed to download prepare-restricted-environment.sh from immutable commit ${prepare_script_commit}"
    return 1
  fi

  if ! actual_prepare_script_checksum=$(sha256sum "${prepare_script_path}"); then
    log::error "Failed to calculate prepare-restricted-environment.sh SHA-256"
    return 1
  fi
  actual_prepare_script_checksum="${actual_prepare_script_checksum%% *}"
  log::info "prepare-restricted-environment.sh source commit: ${prepare_script_commit}"
  log::info "prepare-restricted-environment.sh SHA-256: ${actual_prepare_script_checksum}"
  if [[ "${actual_prepare_script_checksum}" != "${expected_prepare_script_checksum}" ]]; then
    log::error "prepare-restricted-environment.sh checksum mismatch; aborting"
    return 1
  fi
  if ! chmod +x "${prepare_script_path}"; then
    log::error "Failed to make prepare-restricted-environment.sh executable"
    return 1
  fi

  # Use oc-mirror (documented air-gapped OCP path) instead of the script's
  # default skopeo/umoci/podman-build path. Nested Podman in this CI pod cannot
  # initialize storage (newuidmap / VFS chown both fail under hostUsers: false).
  local index_image="quay.io/rhdh-community/operator-catalog:2.0.0"
  local filter_versions="2.0"
  log::info "Using community catalog ${index_image} with filter-versions=${filter_versions}"

  # Local connected OCP: OCP_INTERNAL sentinel (same as omit-on-OCP). CI bastion
  # keeps the external MIRROR_REGISTRY_URL. Route URL stays in MIRROR_REGISTRY_URL
  # for mirror-plugins / registries.conf mounts.
  local to_registry="${MIRROR_REGISTRY_URL}"
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    to_registry="OCP_INTERNAL"
    log::info "LOCAL_DISCONNECTED=1: prepare --to-registry OCP_INTERNAL"
  fi

  local prepare_args=(
    --use-oc-mirror true
    --to-registry "${to_registry}"
    --index-image "${index_image}"
    --filter-versions "${filter_versions}"
  )

  # OCP integrated registry rejects cosign/sigstore .sig attachments
  # ("writing signatures: ... name unknown"). Same as disconnected::run_oc_mirror.
  # CI bastion external mirrors keep prepare's default oc-mirror flags.
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    prepare_args+=(--oc-mirror-flags "--remove-signatures")
    log::info "LOCAL_DISCONNECTED=1: prepare --oc-mirror-flags --remove-signatures"
  fi

  # prepare-restricted-environment.sh skips OLM v1 pull-secret/CA setup for
  # external registries. Catalogd must trust the mirror CA and authenticate
  # before ClusterCatalog can reach Serving=True. Skip on LOCAL_DISCONNECTED —
  # OCP_INTERNAL path configures internal registry trust itself.
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    disconnected::ensure_olm_mirror_pull_secret || return 1
    disconnected::ensure_mirror_registry_ca || return 1
    disconnected::wait_mcp_updated
  else
    log::info "LOCAL_DISCONNECTED=1: skipping external bastion CA/pull-secret pre-prepare helpers"
  fi

  if [[ "${OPENSHIFT_CI:-false}" == "true" ]]; then
    # This value controls only the CI legacy export preflight timing.
    local prepare_max_parallel="${PREPARE_MAX_PARALLEL:-2}"
    if ! [[ "${prepare_max_parallel}" =~ ^[1-9][0-9]*$ ]]; then
      log::error "PREPARE_MAX_PARALLEL must be a positive integer, got '${prepare_max_parallel}'"
      return 1
    fi

    local preflight_export_dir="${DISCONNECTED_TMPDIR}/legacy-export"
    local preflight_render="${preflight_export_dir}/rhdh/rhdh/render.yaml"
    local preflight_dockerfile="${preflight_export_dir}/rhdh/rhdh.Dockerfile"
    local preflight_summary="${ARTIFACT_DIR}/disconnected-operator-legacy-export-summary.txt"
    local preflight_summary_tmp="${DISCONNECTED_TMPDIR}/disconnected-operator-legacy-export-summary.txt"
    local preflight_inventory="${ARTIFACT_DIR}/disconnected-operator-legacy-export-inventory.txt"
    local preflight_checksums="${ARTIFACT_DIR}/disconnected-operator-legacy-export-checksums.sha256"
    local preflight_start_time
    local preflight_end_time
    local preflight_elapsed_seconds
    local preflight_failed=0
    local validation_failed=0
    local cleanup_failed=0
    local selected_bundle_count=0
    local exported_bundle_dir_count=0
    local exported_bundle_index_count=0
    local unpacked_csv_count=0
    local preflight_status="passed"
    local final_status="passed"
    local source_render_status="present"
    local dockerfile_status="present"
    local missing_extra_manifests="none"
    local summary_failed=0
    local checksum_file_count=0
    local bundle_indexes_list="${DISCONNECTED_TMPDIR}/legacy-export-bundle-indexes.list"
    local unpacked_csv_list="${DISCONNECTED_TMPDIR}/legacy-export-unpacked-csv.list"
    local inventory_nul_list="${DISCONNECTED_TMPDIR}/legacy-export-inventory.list"
    local inventory_lines_list="${DISCONNECTED_TMPDIR}/legacy-export-inventory.lines"
    local preflight_checksum_raw="${DISCONNECTED_TMPDIR}/legacy-export-checksums.raw"
    local checksum_file_count_raw
    local checksum_line
    local bundle_dir
    local bundle_index
    local csv_file
    local checksum_path
    local extra_manifest
    local extra_image_path
    local -a exported_bundle_indexes=()
    local -a exported_bundle_dirs=()
    local -a unpacked_csv_files=()
    local -a missing_extra_images=()
    local -A exported_bundle_root_seen=()
    local checksum_artifact_ready=0

    log::section "Legacy Export Preflight"
    log::info "Measuring legacy export preflight only with max-parallel=${prepare_max_parallel}; normal oc-mirror installation is not part of this timing"
    preflight_start_time=$(date +%s)
    local preflight_args=(
      --use-oc-mirror false
      --to-dir "${preflight_export_dir}"
      --index-image "${index_image}"
      --filter-versions "${filter_versions}"
      --max-parallel "${prepare_max_parallel}"
      --extra-images "quay.io/rhdh-community/rhdh:next,quay.io/rhdh-community/rhdh-plugin-installer:next"
      --install-operator false
    )
    if ! disconnected::with_unset_registry_auth_file bash "${prepare_script_path}" "${preflight_args[@]}"; then
      preflight_failed=1
      preflight_status="failed"
      log::error "Legacy export preflight failed"
    fi
    preflight_end_time=$(date +%s)
    preflight_elapsed_seconds=$((preflight_end_time - preflight_start_time))

    if [[ ! -f "${preflight_render}" ]]; then
      source_render_status="missing"
      validation_failed=1
      log::error "Legacy export preflight missing ${preflight_render}"
    else
      if ! selected_bundle_count=$(yq eval-all '[select(.schema == "olm.bundle" and .package == "rhdh")] | length' "${preflight_render}"); then
        selected_bundle_count=0
        validation_failed=1
        log::error "Failed to count rhdh olm.bundle entries in ${preflight_render}"
      fi
      if ! [[ "${selected_bundle_count}" =~ ^[0-9]+$ ]]; then
        selected_bundle_count=0
        validation_failed=1
        log::error "Invalid rhdh olm.bundle count in ${preflight_render}"
      fi
      if ((selected_bundle_count == 0)); then
        validation_failed=1
        log::error "Legacy export source render has no rhdh olm.bundle entries"
      fi
    fi

    if [[ ! -f "${preflight_dockerfile}" ]]; then
      dockerfile_status="missing"
      validation_failed=1
      log::error "Legacy export preflight missing ${preflight_dockerfile}"
    fi

    if ! (cd "${preflight_export_dir}" && find bundles -type f -path '*/src/index.json' -print0) > "${bundle_indexes_list}"; then
      validation_failed=1
      log::error "Failed to discover exported bundle src/index.json files"
    else
      while IFS= read -r -d '' bundle_index; do
        exported_bundle_indexes+=("${bundle_index}")
        bundle_dir="${bundle_index%/src/index.json}"
        if [[ -z "${exported_bundle_root_seen[${bundle_dir}]+present}" ]]; then
          exported_bundle_root_seen["${bundle_dir}"]=1
          exported_bundle_dirs+=("${bundle_dir}")
        fi
      done < "${bundle_indexes_list}"
    fi
    if ! (cd "${preflight_export_dir}" && find bundles -type f -path '*/unpacked/rootfs/manifests/*' \( -name '*.clusterserviceversion.yaml' -o -name '*.csv.yaml' \) -print0) > "${unpacked_csv_list}"; then
      validation_failed=1
      log::error "Failed to discover unpacked CSV files"
    else
      while IFS= read -r -d '' csv_file; do
        unpacked_csv_files+=("${csv_file}")
      done < "${unpacked_csv_list}"
    fi
    exported_bundle_dir_count=${#exported_bundle_dirs[@]}
    exported_bundle_index_count=${#exported_bundle_indexes[@]}
    unpacked_csv_count=${#unpacked_csv_files[@]}

    if ((exported_bundle_dir_count != selected_bundle_count)); then
      validation_failed=1
      log::error "Legacy export bundle directory count ${exported_bundle_dir_count} differs from selected bundle count ${selected_bundle_count}"
    fi
    if ((exported_bundle_index_count != selected_bundle_count)); then
      validation_failed=1
      log::error "Legacy export bundle src/index.json count ${exported_bundle_index_count} differs from selected bundle count ${selected_bundle_count}"
    fi
    if ((unpacked_csv_count < selected_bundle_count)); then
      validation_failed=1
      log::error "Legacy export unpacked CSV count ${unpacked_csv_count} is lower than bundle count ${selected_bundle_count}"
    fi

    for extra_image_path in \
      "quay.io/rhdh-community/rhdh/tag_next/manifest.json" \
      "quay.io/rhdh-community/rhdh-plugin-installer/tag_next/manifest.json"; do
      extra_manifest="${preflight_export_dir}/extraImages/${extra_image_path}"
      if [[ ! -f "${extra_manifest}" ]]; then
        missing_extra_images+=("${extra_image_path}")
      fi
    done
    if ((${#missing_extra_images[@]} > 0)); then
      missing_extra_manifests="${missing_extra_images[*]}"
      validation_failed=1
      log::error "Legacy export missing extra image manifest.json: ${missing_extra_manifests}"
    fi

    if [[ -d "${preflight_export_dir}" ]]; then
      if ! (cd "${preflight_export_dir}" && find . -type f -print0) > "${inventory_nul_list}"; then
        validation_failed=1
        log::error "Failed to create legacy export file inventory"
      elif ! tr '\0' '\n' < "${inventory_nul_list}" > "${inventory_lines_list}"; then
        validation_failed=1
        log::error "Failed to convert legacy export file inventory"
      elif ! sort "${inventory_lines_list}" > "${preflight_inventory}"; then
        validation_failed=1
        log::error "Failed to sort legacy export file inventory"
      fi
    else
      if ! : > "${preflight_inventory}"; then
        validation_failed=1
        log::error "Failed to create empty legacy export file inventory"
      fi
    fi

    local -a checksum_paths=(
      "rhdh/rhdh/render.yaml"
      "rhdh/rhdh.Dockerfile"
    )
    checksum_paths+=("${unpacked_csv_files[@]}")

    if ! : > "${preflight_checksums}"; then
      validation_failed=1
      log::error "Failed to initialize legacy export checksum artifact"
    else
      checksum_artifact_ready=1
    fi
    if ! : > "${preflight_checksum_raw}"; then
      validation_failed=1
      log::error "Failed to initialize raw legacy export checksums"
    fi

    for checksum_path in "${checksum_paths[@]}"; do
      if [[ ! -f "${preflight_export_dir}/${checksum_path}" ]]; then
        validation_failed=1
        log::error "Legacy export checksum input is missing: ${checksum_path}"
        continue
      fi
      if ! checksum_line=$(cd "${preflight_export_dir}" && sha256sum -- "${checksum_path}"); then
        validation_failed=1
        log::error "Failed to calculate legacy export checksum: ${checksum_path}"
        continue
      fi
      if ! printf '%s\n' "${checksum_line}" >> "${preflight_checksum_raw}"; then
        validation_failed=1
        log::error "Failed to write legacy export checksum: ${checksum_path}"
      fi
    done

    if ((checksum_artifact_ready == 1)); then
      if ! sort "${preflight_checksum_raw}" > "${preflight_checksums}"; then
        validation_failed=1
        log::error "Failed to sort legacy export checksums"
      elif ! checksum_file_count_raw=$(wc -l < "${preflight_checksums}"); then
        validation_failed=1
        log::error "Failed to count legacy export checksums"
      else
        checksum_file_count="${checksum_file_count_raw//[[:space:]]/}"
        if ! [[ "${checksum_file_count}" =~ ^[0-9]+$ ]]; then
          validation_failed=1
          checksum_file_count=0
          log::error "Invalid legacy export checksum count: ${checksum_file_count_raw}"
        fi
      fi
    fi

    if [[ -d "${preflight_export_dir}" ]] && ! rm -rf "${preflight_export_dir}"; then
      cleanup_failed=1
      log::error "Failed to remove legacy export directory ${preflight_export_dir}"
    fi

    if [[ "${preflight_failed}" -eq 1 || "${validation_failed}" -eq 1 || "${cleanup_failed}" -eq 1 ]]; then
      final_status="failed"
    fi

    if ! printf '%s\n' \
      "status=${final_status}" \
      "preflight_status=${preflight_status}" \
      "preflight_failed=${preflight_failed}" \
      "validation_failed=${validation_failed}" \
      "cleanup_failed=${cleanup_failed}" \
      "source_commit=${prepare_script_commit}" \
      "script_sha256=${actual_prepare_script_checksum}" \
      "index_image=${index_image}" \
      "filter_versions=${filter_versions}" \
      "max_parallel=${prepare_max_parallel}" \
      "timing_scope=legacy-export-preflight-only" \
      "legacy_export_preflight_elapsed_seconds=${preflight_elapsed_seconds}" \
      "render_yaml=${source_render_status}" \
      "dockerfile=${dockerfile_status}" \
      "selected_bundle_count=${selected_bundle_count}" \
      "exported_bundle_dir_count=${exported_bundle_dir_count}" \
      "exported_bundle_src_index_count=${exported_bundle_index_count}" \
      "unpacked_csv_count=${unpacked_csv_count}" \
      "missing_extra_manifests=${missing_extra_manifests}" \
      "checksum_artifact=${preflight_checksums##*/}" \
      "checksum_file_count=${checksum_file_count}" \
      > "${preflight_summary_tmp}"; then
      summary_failed=1
      log::error "Failed to write legacy export preflight summary"
      if ! rm -f "${preflight_summary_tmp}"; then
        log::error "Failed to remove temporary legacy export preflight summary"
      fi
      if ! rm -f "${preflight_summary}"; then
        log::error "Failed to remove stale legacy export preflight summary"
      fi
    elif ! mv -f "${preflight_summary_tmp}" "${preflight_summary}"; then
      summary_failed=1
      log::error "Failed to publish legacy export preflight summary"
      if ! rm -f "${preflight_summary_tmp}"; then
        log::error "Failed to remove temporary legacy export preflight summary"
      fi
      if ! rm -f "${preflight_summary}"; then
        log::error "Failed to remove stale legacy export preflight summary"
      fi
    fi

    if ((preflight_failed || validation_failed || cleanup_failed || summary_failed)); then
      log::error "Legacy export preflight did not pass; aborting before oc-mirror install"
      return 1
    fi
    log::success "Legacy export preflight passed in ${preflight_elapsed_seconds}s"
  fi

  log::info "Running prepare-restricted-environment.sh with: ${prepare_args[*]}"
  if ! disconnected::retry_on_local_registry 5 \
    disconnected::with_unset_registry_auth_file \
    bash "${prepare_script_path}" "${prepare_args[@]}"; then
    log::error "prepare-restricted-environment.sh failed — aborting"
    return 1
  fi
  log::success "Operator installed via prepare-restricted-environment.sh"

  # prepare patches the operator SA with internal-registry secret names that do
  # not exist for an external mirror. Provide a real mirror pull secret and
  # attach it to the OLM v1 installer SA used by ClusterExtension.
  # Skip on LOCAL_DISCONNECTED — OCP_INTERNAL uses cluster-internal pull secrets.
  if [[ "${LOCAL_DISCONNECTED:-}" != "1" ]]; then
    local operator_ns="rhdh-operator"
    oc create secret generic reg-pull-secret \
      --from-file=.dockerconfigjson="${MIRROR_REGISTRY_PULL_SECRET}" \
      --type=kubernetes.io/dockerconfigjson \
      -n "${operator_ns}" \
      --dry-run=client -o yaml | oc apply -f - || {
      log::error "Failed to create reg-pull-secret in ${operator_ns}"
      return 1
    }
    oc patch serviceaccount rhdh-operator-installer -n "${operator_ns}" --type=merge \
      -p '{"imagePullSecrets":[{"name":"reg-pull-secret"}]}' || {
      log::warn "Failed to patch rhdh-operator-installer imagePullSecrets — continuing"
    }
    log::success "Configured mirror pull secret on rhdh-operator-installer SA"
  else
    log::info "LOCAL_DISCONNECTED=1: skipping reg-pull-secret SA patch"
    # OCP_INTERNAL: grant catalogd/operator-controller pull on oc-mirror and
    # rewrite route-based IDMS → in-cluster registry service (else Serving never
    # becomes True → Backstage CRD timeout).
    disconnected::ensure_local_ocp_internal_olm_access || return 1
  fi

  # prepare-restricted-environment.sh applies IDMS/CatalogSource which triggers
  # a MachineConfig update and node rolling. Wait for completion before deploying
  # workloads, same as the Helm path.
  disconnected::wait_mcp_updated

  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    # Catalogd needs the registry + image-puller grants above before Serving=True.
    log::info "Waiting for ClusterCatalog/rhdh-catalog Serving=True (LOCAL_DISCONNECTED)..."
    local catalog_wait=0
    until [[ "$(oc get clustercatalog rhdh-catalog -o jsonpath='{.status.conditions[?(@.type=="Serving")].status}' 2> /dev/null || true)" == "True" ]]; do
      if ((catalog_wait >= 600)); then
        log::error "ClusterCatalog/rhdh-catalog did not become Serving=True within 600s"
        disconnected::dump_olm_v1_status "rhdh-operator"
        return 1
      fi
      sleep 15
      catalog_wait=$((catalog_wait + 15))
    done
    log::success "ClusterCatalog/rhdh-catalog is Serving=True"
  fi

  # prepare only creates the ClusterExtension; wait until OLM v1 installs the
  # operator and the Backstage CRD appears (dump status on timeout).
  disconnected::wait_operator_crd_olm_v1 "rhdh-operator" "backstages.rhdh.redhat.com" 600 || {
    log::error "Backstage CRD not available after operator installation"
    return 1
  }

  log::section "Plugin Mirroring"
  # Both CI and LOCAL_DISCONNECTED consume CATALOG_INDEX_IMAGE (the shared env
  # contract from env_variables.sh, derived from RELEASE_VERSION when unset).
  disconnected::mirror_plugins || return 1

  # Pin CATALOG_INDEX_IMAGE to the digest actually pushed (hub profile default
  # digest is often absent from the mirror). Homepage package is the digest-pinned
  # OCI exported as HOMEPAGE_PLUGIN_PACKAGE (ref:// cannot resolve with includes: []).
  disconnected::resolve_catalog_index_image || return 1

  log::section "Namespace and Secrets"

  namespace::configure "${NAME_SPACE}"
  if [[ "${LOCAL_DISCONNECTED:-}" == "1" ]]; then
    disconnected::ensure_local_image_pull_access "${NAME_SPACE}" || return 1
  fi
  disconnected::apply_plugin_mirror_configmap "${NAME_SPACE}" || return 1
  # Same CA/auth secrets as Helm so skopeo in install-dynamic-plugins can pull
  # from the mirror (registries.conf alone is not enough — TLS verify fails).
  disconnected::create_mirror_registry_ca_configmap "${NAME_SPACE}" || return 1
  disconnected::create_plugin_registry_auth_secret "${NAME_SPACE}" || return 1
  disconnected::create_homepage_plugins_configmap "${NAME_SPACE}" || return 1

  # Operator mounts one volume per extraFiles ConfigMap name. policy.json cannot
  # share rhdh-plugin-mirror-conf or reconcile fails with duplicate volume keys.
  oc create configmap rhdh-plugin-mirror-policy \
    --from-file=policy.json="${DIR}/resources/disconnected/policy.json" \
    -n "${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create rhdh-plugin-mirror-policy ConfigMap — aborting"
    return 1
  }
  log::success "ConfigMap rhdh-plugin-mirror-policy created in ${NAME_SPACE}"

  log::section "Backstage CR Deployment"

  # Minimal guest-auth ConfigMap (full rhdh-start.yaml references ConfigMaps/Secrets
  # created by apply_yaml_files(), which this disconnected handler skips).
  oc create configmap app-config-rhdh-disconnected-smoke \
    --from-file="app-config-rhdh.yaml=${DIR}/resources/disconnected/app-config-rhdh-disconnected-smoke.yaml" \
    --namespace="${NAME_SPACE}" \
    --dry-run=client -o yaml | oc apply -f - || {
    log::error "Failed to create app-config ConfigMap — aborting"
    return 1
  }

  # Backstage CR template includes extraFiles/extraEnvs for disconnected mounts
  # (registries.conf, policy.json, mirror CA, auth.json).
  local cr_temp="${DISCONNECTED_TMPDIR}/backstage-cr-disconnected.yaml"
  envsubst < "${DIR}/resources/rhdh-operator/rhdh-start-disconnected-smoke.yaml" > "${cr_temp}"

  cp "${cr_temp}" "${ARTIFACT_DIR}/disconnected-backstage-cr.yaml" 2> /dev/null || true

  deploy_rhdh_operator "${NAME_SPACE}" "${cr_temp}"
  log::success "Backstage CR deployed in ${NAME_SPACE}"

  log::section "Smoke Test"

  local url="https://backstage-${RELEASE_NAME}-${NAME_SPACE}.${K8S_CLUSTER_ROUTER_BASE}"
  testing::check_and_test "${RELEASE_NAME}" "${NAME_SPACE}" "${PW_PROJECT_SMOKE_TEST}" "${url}"

  log::success "Disconnected Operator smoke test completed"
}
