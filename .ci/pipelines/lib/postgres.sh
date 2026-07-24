#!/usr/bin/env bash

# PostgreSQL helpers for chart-managed / operator-local database upgrades.
# Dependencies: oc, lib/log.sh
#
# Install method awareness (INSTALL_METHOD=helm|operator):
#   helm     — label app.kubernetes.io/name=postgresql, deploy ${release}-developer-hub
#   operator — label rhdh.redhat.com/app=backstage-psql-${cr}, deploy backstage-${cr}
#
# IMPORTANT: functions that print a pod name on stdout (for capture) MUST send
# all diagnostics to stderr, otherwise callers using $(...) swallow the evidence.

# Prevent re-sourcing
if [[ -n "${POSTGRES_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly POSTGRES_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# ---------------------------------------------------------------------------
# Install-method helpers
# ---------------------------------------------------------------------------

# Backstage Deployment name for the given release / CR name.
rhdh_deployment_name() {
  local release_name=$1
  if [[ "${INSTALL_METHOD:-helm}" == "operator" ]]; then
    echo "backstage-${release_name}"
  else
    echo "${release_name}-developer-hub"
  fi
}

# CR / release name used for operator-local Postgres resources.
_postgres_cr_name() {
  echo "${POSTGRES_CR_NAME:-${RELEASE_NAME:-rhdh}}"
}

# Resolve a Ready-candidate Postgres pod name in the namespace (or empty).
_postgres_find_pod() {
  local namespace=$1
  local pod=""
  if [[ "${INSTALL_METHOD:-helm}" == "operator" ]]; then
    local cr
    cr=$(_postgres_cr_name)
    pod=$(oc get pods -n "${namespace}" -l "rhdh.redhat.com/app=backstage-psql-${cr}" \
      -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
    if [[ -z "${pod}" ]]; then
      pod=$(oc get pods -n "${namespace}" \
        -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' 2> /dev/null \
        | grep -E "^backstage-psql-${cr}-" | head -1 || true)
    fi
  else
    pod=$(oc get pods -n "${namespace}" -l "app.kubernetes.io/name=postgresql" \
      -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
  fi
  echo "${pod}"
}

# StatefulSet readyReplicas for the managed Postgres instance (or 0).
_postgres_sts_ready_replicas() {
  local namespace=$1
  local sts_ready=""
  if [[ "${INSTALL_METHOD:-helm}" == "operator" ]]; then
    local cr
    cr=$(_postgres_cr_name)
    sts_ready=$(oc get statefulset -n "${namespace}" "backstage-psql-${cr}" \
      -o jsonpath='{.status.readyReplicas}' 2> /dev/null || true)
    if [[ -z "${sts_ready}" ]]; then
      sts_ready=$(oc get statefulset -n "${namespace}" \
        -l "rhdh.redhat.com/app=backstage-psql-${cr}" \
        -o jsonpath='{.items[0].status.readyReplicas}' 2> /dev/null || true)
    fi
  else
    sts_ready=$(oc get statefulset -n "${namespace}" -l "app.kubernetes.io/name=postgresql" \
      -o jsonpath='{.items[0].status.readyReplicas}' 2> /dev/null || true)
  fi
  echo "${sts_ready:-0}"
}

# Point the RHDH operator at a different Fedora/RHEL PostgreSQL image via RELATED_IMAGE_postgresql.
# Args:
#   $1 - full image ref (e.g. quay.io/fedora/postgresql-18:latest)
set_operator_postgresql_related_image() {
  local image=$1
  local ns="${OPERATOR_MANAGER:-rhdh-operator}"
  local deploy

  if [[ -z "${image}" ]]; then
    log::error "set_operator_postgresql_related_image: image required"
    return 1
  fi

  log::info "Setting RELATED_IMAGE_postgresql=${image} on operator controller in ${ns}"
  deploy=$(oc get deploy -n "${ns}" -l control-plane=controller-manager \
    -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
  if [[ -z "${deploy}" ]]; then
    deploy=$(oc get deploy -n "${ns}" -o jsonpath='{.items[0].metadata.name}' 2> /dev/null || true)
  fi
  if [[ -z "${deploy}" ]]; then
    log::error "No operator Deployment found in ${ns}"
    return 1
  fi

  oc set env "deployment/${deploy}" -n "${ns}" "RELATED_IMAGE_postgresql=${image}"
  if ! oc rollout status "deployment/${deploy}" -n "${ns}" --timeout=5m; then
    log::error "Operator rollout failed after RELATED_IMAGE_postgresql update"
    oc get pods -n "${ns}" -o wide >&2 || true
    oc logs -n "${ns}" "deploy/${deploy}" --tail=80 >&2 || true
    return 1
  fi
  log::info "Operator controller ready with RELATED_IMAGE_postgresql=${image}"
}

# Dump postgres pod diagnostics to stderr (safe under $(...) capture).
# Args:
#   $1 - namespace
dump_postgres_diagnostics() {
  local namespace=$1
  {
    log::info "PostgreSQL diagnostics for namespace: ${namespace}"
    oc get pods,statefulset,pvc -n "${namespace}" -o wide 2>&1 | grep -iE 'postgres|NAME' || true
    oc get pods -n "${namespace}" -o wide 2>&1 | head -40 || true
    local pg_pod
    pg_pod=$(_postgres_find_pod "${namespace}")
    if [[ -z "$pg_pod" ]]; then
      log::warn "No postgresql pod found; listing all pods containing 'postgres'"
      oc get pods -n "${namespace}" 2>&1 | grep -i postgres || true
      return 0
    fi
    log::info "Pod image/status for ${pg_pod}:"
    oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='image={.spec.containers[0].image} phase={.status.phase} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}' 2>&1 || true
    log::info "Describe pod ${pg_pod}:"
    oc describe pod -n "${namespace}" "${pg_pod}" 2>&1 | tail -100 || true
    log::info "Logs for ${pg_pod} (current):"
    oc logs -n "${namespace}" "${pg_pod}" --tail=200 2>&1 || true
    log::info "Logs for ${pg_pod} (previous):"
    oc logs -n "${namespace}" "${pg_pod}" --previous --tail=200 2>&1 || true
    if [[ "${INSTALL_METHOD:-helm}" == "operator" ]]; then
      log::info "Operator RELATED_IMAGE_postgresql:"
      oc get deploy -n "${OPERATOR_MANAGER:-rhdh-operator}" -o jsonpath='{range .items[*]}{.metadata.name}{" RELATED_IMAGE_postgresql="}{range .spec.template.spec.containers[0].env[?(@.name=="RELATED_IMAGE_postgresql")]}{.value}{end}{"\n"}{end}' 2>&1 || true
      log::info "Backstage CR (database):"
      oc get backstage -n "${namespace}" -o yaml 2>&1 | grep -A20 -E 'database:|enableLocalDb' || true
    else
      log::info "Helm values snapshot (postgresql image):"
      helm get values rhdh -n "${namespace}" 2>&1 | grep -A20 -E 'postgresql:|^  image:' || true
    fi
  } >&2
}

# Wait until PostgreSQL is Ready and (optionally) running an expected image substring.
# Args:
#   $1 - namespace
#   $2 - optional max wait seconds (default: 600)
#   $3 - optional image substring that must appear in the container image
# Prints the pod name on success; returns 1 on timeout.
wait_for_postgres_ready() {
  local namespace=$1
  local max_wait=${2:-600}
  local expected_image_substr=${3:-}
  local pg_pod=""
  local waited=0

  if [[ -n "${expected_image_substr}" ]]; then
    log::info "Waiting for PostgreSQL Ready with image containing '${expected_image_substr}' in ${namespace}"
  else
    log::info "Waiting for PostgreSQL pod to be Ready in namespace: ${namespace}"
  fi

  while [[ $waited -lt $max_wait ]]; do
    pg_pod=$(_postgres_find_pod "${namespace}")
    if [[ -n "$pg_pod" ]]; then
      local phase ready image sts_ready
      phase=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.status.phase}' 2> /dev/null || true)
      ready=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2> /dev/null || true)
      image=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.spec.containers[0].image}' 2> /dev/null || true)
      sts_ready=$(_postgres_sts_ready_replicas "${namespace}")

      # Periodic progress on INFO so CI logs show what we are waiting for.
      if ((waited % 60 == 0)); then
        log::info "Still waiting… pod=${pg_pod:-none} phase=${phase:-?} ready=${ready:-?} sts_ready=${sts_ready:-0} image=${image:-?} (${waited}s/${max_wait}s)"
      fi

      if [[ -n "${expected_image_substr}" && "${image}" != *"${expected_image_substr}"* ]]; then
        :
      elif [[ "$phase" == "Running" && "$ready" == "True" && "${sts_ready:-0}" -ge 1 ]]; then
        log::info "PostgreSQL pod is Ready: ${pg_pod} (image=${image})"
        echo "${pg_pod}"
        return 0
      fi
    elif ((waited % 60 == 0)); then
      log::info "Still waiting… no postgresql pod yet (${waited}s/${max_wait}s)"
      oc get pods -n "${namespace}" -o wide >&2 || true
    fi
    sleep 10
    waited=$((waited + 10))
  done

  log::error "PostgreSQL pod not Ready in namespace ${namespace} after ${max_wait}s"
  dump_postgres_diagnostics "${namespace}"
  return 1
}

# Log the running PostgreSQL server version (for upgrade evidence).
log_postgres_version() {
  local namespace=$1
  local pg_pod=${2:-}

  if [[ -z "$pg_pod" ]]; then
    pg_pod=$(_postgres_find_pod "${namespace}")
  fi
  if [[ -z "$pg_pod" ]]; then
    log::warn "Cannot log PostgreSQL version: no pod found in ${namespace}"
    return 0
  fi

  local version
  version=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -t -A -c "SHOW server_version;" 2> /dev/null | tr -d '[:space:]' || true)
  local image
  image=$(oc get pod -n "${namespace}" "${pg_pod}" -o jsonpath='{.spec.containers[0].image}' 2> /dev/null || true)
  log::info "PostgreSQL evidence — version='${version:-unknown}' image='${image:-unknown}' pod='${pg_pod}'"
}

# Refresh PostgreSQL collation versions after a major version upgrade.
# Args:
#   $1 - namespace
#   $2 - optional max wait seconds (default: 600)
#   $3 - optional expected image substring (e.g. postgresql-18)
refresh_postgres_collation_versions() {
  local namespace=$1
  local max_wait=${2:-600}
  local expected_image_substr=${3:-}

  log::info "Refreshing PostgreSQL collation versions in namespace: ${namespace}"

  local pg_pod
  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" "${max_wait}" "${expected_image_substr}"); then
    log::warn "Skipping collation refresh; PostgreSQL not Ready."
    return 0
  fi

  log::info "Found PostgreSQL pod: ${pg_pod}"

  # Keep stderr separate so WARNING/DETAIL/HINT lines are not treated as DB names.
  local databases
  databases=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -t -A -c \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres');" 2> /dev/null \
    | grep -E '^[A-Za-z0-9_.:-]+$' || true)
  log::info "User databases for collation refresh: ${databases:-<none>}"

  local db out
  for db in postgres template1 $databases; do
    if [[ -z "$db" ]]; then
      continue
    fi
    log::info "Refreshing collation version for database: ${db}"
    out=$(oc exec -n "${namespace}" "${pg_pod}" -- psql -U postgres -v ON_ERROR_STOP=1 -c \
      "ALTER DATABASE \"${db}\" REFRESH COLLATION VERSION;" 2>&1) \
      && log::debug "${out}" \
      || log::warn "Failed to refresh collation for ${db}: ${out}"
  done

  log::info "Collation version refresh completed for namespace: ${namespace}"
}

# Dump all databases from the chart-managed PostgreSQL (for dump/restore upgrades).
# Args:
#   $1 - namespace
#   $2 - output file path
postgres_dumpall_to_file() {
  local namespace=$1
  local outfile=$2
  local pg_pod

  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" 300); then
    log::error "Cannot dumpall: PostgreSQL not Ready in ${namespace}"
    return 1
  fi

  log::info "Running pg_dumpall from ${pg_pod} → ${outfile}"
  mkdir -p "$(dirname "${outfile}")"
  if ! oc exec -n "${namespace}" "${pg_pod}" -- pg_dumpall -U postgres > "${outfile}"; then
    log::error "pg_dumpall failed"
    return 1
  fi
  log::info "pg_dumpall wrote $(wc -c < "${outfile}" | tr -d ' ') bytes"
}

# Wipe the chart-managed Postgres PVC so the next helm install can initdb fresh.
# Args:
#   $1 - namespace
postgres_wipe_persistent_volume() {
  local namespace=$1
  local cr pvc

  log::info "Wiping PostgreSQL StatefulSet + PVC in ${namespace} for dump/restore upgrade (INSTALL_METHOD=${INSTALL_METHOD:-helm})"
  if [[ "${INSTALL_METHOD:-helm}" == "operator" ]]; then
    cr=$(_postgres_cr_name)
    # Keep backstage-psql-secret-${cr} so RHDH credentials remain valid after restore.
    oc delete statefulset -n "${namespace}" "backstage-psql-${cr}" --wait=true --timeout=5m 2>&1 || true
    oc delete pod -n "${namespace}" -l "rhdh.redhat.com/app=backstage-psql-${cr}" --force --grace-period=0 2>&1 || true
    pvc=$(oc get pvc -n "${namespace}" -o name 2> /dev/null | grep -i "backstage-psql-${cr}" | head -1 || true)
    if [[ -z "${pvc}" ]]; then
      pvc=$(oc get pvc -n "${namespace}" -o name 2> /dev/null | grep -i postgres | head -1 || true)
    fi
    if [[ -n "${pvc}" ]]; then
      log::info "Deleting ${pvc}"
      oc delete -n "${namespace}" "${pvc}" --wait=true --timeout=5m 2>&1 || true
    else
      log::warn "No postgres PVC found to delete"
    fi
    # Nudge the Backstage CR so the operator recreates the STS with the new RELATED_IMAGE.
    oc annotate backstage "${cr}" -n "${namespace}" "rhdh.redhat.com/pg-upgrade-reconcile=$(date +%s)" --overwrite 2>&1 || true
  else
    oc delete statefulset -n "${namespace}" -l "app.kubernetes.io/name=postgresql" --wait=true --timeout=5m 2>&1 || true
    oc delete pod -n "${namespace}" -l "app.kubernetes.io/name=postgresql" --force --grace-period=0 2>&1 || true
    pvc=$(oc get pvc -n "${namespace}" -o name 2> /dev/null | grep -i postgres | head -1 || true)
    if [[ -n "${pvc}" ]]; then
      log::info "Deleting ${pvc}"
      oc delete -n "${namespace}" "${pvc}" --wait=true --timeout=5m 2>&1 || true
    else
      log::warn "No postgres PVC found to delete"
    fi
  fi
}

# Restore a pg_dumpall file into a Ready PostgreSQL pod.
# Args:
#   $1 - namespace
#   $2 - dump file path
#   $3 - optional expected image substring
postgres_restore_dumpall_file() {
  local namespace=$1
  local dumpfile=$2
  local expected_image_substr=${3:-}
  local pg_pod

  if ! pg_pod=$(wait_for_postgres_ready "${namespace}" 600 "${expected_image_substr}"); then
    log::error "Cannot restore: PostgreSQL not Ready in ${namespace}"
    return 1
  fi

  log::info "Restoring pg_dumpall into ${pg_pod} from ${dumpfile}"
  # Ignore benign "already exists" errors from globals/roles created by image init.
  if ! oc exec -i -n "${namespace}" "${pg_pod}" -- psql -U postgres -v ON_ERROR_STOP=0 < "${dumpfile}"; then
    log::error "psql restore failed"
    return 1
  fi
  log::info "pg_dumpall restore completed"
}

# Return the UID of a Running RHDH (developer-hub) pod for the release, or empty.
# Args:
#   $1 - release name (e.g. rhdh)
#   $2 - namespace
get_rhdh_pod_uid() {
  local release_name=$1
  local namespace=$2
  local name uid
  local deploy
  deploy=$(rhdh_deployment_name "${release_name}")

  while IFS=$'\t' read -r name uid; do
    if [[ -n "${name}" && "${name}" == "${deploy}"* && -n "${uid}" ]]; then
      echo "${uid}"
      return 0
    fi
  done < <(oc get pods -n "${namespace}" --field-selector=status.phase=Running \
    -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\n"}{end}' 2> /dev/null || true)

  return 0
}

# Wait until the previous RHDH pod UID is gone and a different Ready pod exists.
# Args:
#   $1 - release name
#   $2 - namespace
#   $3 - previous pod UID
#   $4 - optional max wait seconds (default: 600)
wait_for_rhdh_pod_replaced() {
  local release_name=$1
  local namespace=$2
  local previous_uid=$3
  local max_wait=${4:-600}
  local waited=0
  local deploy
  deploy=$(rhdh_deployment_name "${release_name}")

  if [[ -z "${previous_uid}" ]]; then
    log::warn "No previous RHDH pod UID provided; skipping pod-replacement wait"
    return 0
  fi

  log::info "Waiting for previous RHDH pod (uid=${previous_uid}) to terminate and a new Ready pod for ${deploy}"

  while [[ $waited -lt $max_wait ]]; do
    local uid_still_present="false"
    local uids
    uids=$(oc get pods -n "${namespace}" -o jsonpath='{range .items[*]}{.metadata.uid}{"\n"}{end}' 2> /dev/null || true)
    if grep -qx "${previous_uid}" <<< "${uids}"; then
      uid_still_present="true"
    fi

    local new_name="" new_uid="" phase="" ready=""
    while IFS=$'\t' read -r new_name new_uid phase ready; do
      if [[ -n "${new_name}" && "${new_name}" == "${deploy}"* ]]; then
        break
      fi
      new_name=""
      new_uid=""
    done < <(oc get pods -n "${namespace}" \
      -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.metadata.uid}{"\t"}{.status.phase}{"\t"}{.status.conditions[?(@.type=="Ready")].status}{"\n"}{end}' 2> /dev/null || true)

    if [[ "${uid_still_present}" != "true" && -n "${new_uid}" && "${new_uid}" != "${previous_uid}" && "${phase}" == "Running" && "${ready}" == "True" ]]; then
      log::info "New RHDH pod is Ready: name=${new_name} uid=${new_uid} (previous uid=${previous_uid} terminated)"
      echo "${new_uid}"
      return 0
    fi

    if ((waited % 30 == 0)); then
      log::info "Still waiting for RHDH pod replacement… previous_present=${uid_still_present} new=${new_name:-none} phase=${phase:-?} ready=${ready:-?} (${waited}s/${max_wait}s)"
      oc get pods -n "${namespace}" -o wide >&2 | grep -E "${deploy}|NAME" || true
    fi

    sleep 5
    waited=$((waited + 5))
  done

  log::error "Timed out waiting for RHDH pod replacement (previous uid=${previous_uid})"
  oc get pods -n "${namespace}" -o wide >&2 || true
  return 1
}

# Ensure RHDH has rolled onto a new pod after a DB upgrade hop.
# Restarts the deployment when the old UID is still current, then waits for replacement.
# Args:
#   $1 - release name
#   $2 - namespace
#   $3 - previous pod UID
#   $4 - optional max wait seconds (default: 600)
ensure_rhdh_pod_replaced() {
  local release_name=$1
  local namespace=$2
  local previous_uid=$3
  local max_wait=${4:-600}
  local deploy
  local current_uid
  deploy=$(rhdh_deployment_name "${release_name}")

  if [[ -z "${previous_uid}" ]]; then
    return 0
  fi

  current_uid=$(get_rhdh_pod_uid "${release_name}" "${namespace}")
  if [[ "${current_uid}" == "${previous_uid}" ]]; then
    log::info "RHDH pod uid unchanged after DB upgrade (${current_uid}); restarting ${deploy} so verification hits a new pod"
    oc rollout restart "deployment/${deploy}" -n "${namespace}" || true
  else
    log::info "RHDH pod uid already changed (${previous_uid} → ${current_uid:-none}); waiting for previous pod to terminate"
  fi

  wait_for_rhdh_pod_replaced "${release_name}" "${namespace}" "${previous_uid}" "${max_wait}" > /dev/null
}

# Resolve a cluster-local runtime for the data-proof static server.
# Prints: image<TAB>command<TAB>scriptPath
_pg_upgrade_data_proof_runtime() {
  local python_tag nodejs_tag

  python_tag=$(oc get imagestream python -n openshift -o jsonpath='{.spec.tags[*].name}' 2> /dev/null \
    | tr ' ' '\n' | grep -E '^[0-9]+\.[0-9]+-ubi[0-9]+$' | sort -V | tail -1 || true)
  if [[ -n "${python_tag}" ]]; then
    printf '%s\t%s\t%s\n' \
      "image-registry.openshift-image-registry.svc:5000/openshift/python:${python_tag}" \
      "python3" \
      "/www/serve.py"
    return 0
  fi

  nodejs_tag=$(oc get imagestream nodejs -n openshift -o jsonpath='{.spec.tags[*].name}' 2> /dev/null \
    | tr ' ' '\n' | grep -E '^[0-9]+-ubi[0-9]+$' | sort -t'-' -k1 -n | tail -1 || true)
  nodejs_tag="${nodejs_tag:-18-ubi8}"
  printf '%s\t%s\t%s\n' \
    "image-registry.openshift-image-registry.svc:5000/openshift/nodejs:${nodejs_tag}" \
    "node" \
    "/www/serve.js"
}

# Deploy an in-cluster static server that hosts the persistence-proof catalog entity.
# Args:
#   $1 - namespace
deploy_pg_upgrade_data_proof_fixture() {
  local namespace=$1
  local manifest="${DIR}/resources/pg-upgrade/data-proof-server.yaml"
  local runtime image cmd script
  local rendered="/tmp/pg-upgrade-data-proof-server.yaml"

  if [[ ! -f "${manifest}" ]]; then
    log::error "Missing data-proof fixture manifest: ${manifest}"
    return 1
  fi

  runtime=$(_pg_upgrade_data_proof_runtime)
  image=$(cut -f1 <<< "${runtime}")
  cmd=$(cut -f2 <<< "${runtime}")
  script=$(cut -f3 <<< "${runtime}")

  log::info "Deploying pg-upgrade data-proof fixture in ${namespace} using ${image} (${cmd} ${script})"

  sed \
    -e "s|PG_UPGRADE_DATA_PROOF_IMAGE|${image}|g" \
    -e "s|PG_UPGRADE_DATA_PROOF_COMMAND|${cmd}|g" \
    -e "s|PG_UPGRADE_DATA_PROOF_SCRIPT|${script}|g" \
    "${manifest}" > "${rendered}"

  oc apply -n "${namespace}" -f "${rendered}"
  if ! oc rollout status "deployment/pg-upgrade-data-proof" -n "${namespace}" --timeout=3m; then
    log::error "pg-upgrade data-proof fixture failed to become Ready"
    oc get pods,svc -n "${namespace}" -l app=pg-upgrade-data-proof -o wide >&2 || true
    oc describe deployment/pg-upgrade-data-proof -n "${namespace}" >&2 || true
    oc logs -n "${namespace}" deploy/pg-upgrade-data-proof --tail=50 >&2 || true
    return 1
  fi
}

# Resolve a publicly fetchable catalog-info URL for the persistence-proof entity.
# Prefer an explicit override, else GitHub blob URL at the PR/head SHA (Backstage
# blocks most in-cluster http://*.svc targets via URL reader / SSRF guards).
pg_upgrade_data_proof_target_url() {
  if [[ -n "${PG_UPGRADE_PROOF_URL:-}" ]]; then
    echo "${PG_UPGRADE_PROOF_URL}"
    return 0
  fi

  local sha="${PULL_PULL_SHA:-${PULL_BASE_SHA:-}}"
  if [[ -z "${sha}" ]]; then
    sha=$(git -C "${DIR}/../.." rev-parse HEAD 2> /dev/null || true)
  fi
  local repo="${PG_UPGRADE_PROOF_REPO:-zdrapela/rhdh}"
  if [[ -z "${sha}" ]]; then
    log::error "Cannot resolve pg-upgrade proof catalog URL (set PG_UPGRADE_PROOF_URL or PULL_PULL_SHA)"
    return 1
  fi
  echo "https://github.com/${repo}/blob/${sha}/.ci/pipelines/resources/pg-upgrade/catalog-info.yaml"
}

# Register the persistence-proof Component via the Catalog Locations API and wait until it is queryable.
# Args:
#   $1 - Backstage base URL
#   $2 - namespace (unused; kept for call-site compatibility)
seed_pg_upgrade_data_proof() {
  local base_url=$1
  local _namespace=$2
  local target
  local entity_url="${base_url}/api/catalog/entities/by-name/component/default/pg-upgrade-data-proof"
  local locations_url="${base_url}/api/catalog/locations"
  local max_wait=${3:-180}
  local waited=0
  local status body

  if ! target=$(pg_upgrade_data_proof_target_url); then
    return 1
  fi

  log::info "Seeding pg-upgrade data proof location: ${target}"

  status=$(curl --insecure -s -o /tmp/pg-upgrade-seed-location.json -w "%{http_code}" \
    -X POST "${locations_url}" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"url\",\"target\":\"${target}\"}" || echo "000")

  if [[ "${status}" != "201" && "${status}" != "409" ]]; then
    log::error "Failed to register data-proof location (HTTP ${status})"
    cat /tmp/pg-upgrade-seed-location.json >&2 || true
    return 1
  fi
  log::info "Location register response HTTP ${status}"

  log::info "Waiting for entity pg-upgrade-data-proof to appear in catalog"
  while [[ $waited -lt $max_wait ]]; do
    status=$(curl --insecure -s -o /tmp/pg-upgrade-seed-entity.json -w "%{http_code}" "${entity_url}" || echo "000")
    if [[ "${status}" == "200" ]]; then
      body=$(cat /tmp/pg-upgrade-seed-entity.json)
      if grep -q "RHIDP-14594" <<< "${body}" && grep -q "pg-upgrade-data-proof" <<< "${body}"; then
        log::info "Seeded catalog entity is present (RHIDP-14594 persistence proof)"
        return 0
      fi
    fi
    if ((waited % 30 == 0)); then
      log::info "Still waiting for seeded entity… HTTP ${status} (${waited}s/${max_wait}s)"
    fi
    sleep 5
    waited=$((waited + 5))
  done

  log::error "Timed out waiting for seeded entity pg-upgrade-data-proof"
  cat /tmp/pg-upgrade-seed-entity.json >&2 || true
  curl --insecure -s "${locations_url}" >&2 || true
  return 1
}

# Log API evidence that the persistence-proof entity still exists (post-upgrade).
# Args:
#   $1 - Backstage base URL
assert_pg_upgrade_data_proof_api() {
  local base_url=$1
  local entity_url="${base_url}/api/catalog/entities/by-name/component/default/pg-upgrade-data-proof"
  local status body

  status=$(curl --insecure -s -o /tmp/pg-upgrade-verify-entity.json -w "%{http_code}" "${entity_url}" || echo "000")
  body=$(cat /tmp/pg-upgrade-verify-entity.json 2> /dev/null || true)
  if [[ "${status}" != "200" ]] || ! grep -q "RHIDP-14594" <<< "${body}"; then
    log::error "Persistence proof entity missing or incomplete via API (HTTP ${status})"
    echo "${body}" >&2
    return 1
  fi
  log::info "API persistence proof OK: component/default/pg-upgrade-data-proof still present after upgrade"
}
