#!/bin/bash
# RHIDP-15792: deploy Caddy in front of RHDH and verify HTTP/2 (ALPN) + HTTP/1.1 fallback.
# Intended for ephemeral K8s Helm nightlies (Path A). Does not modify Playwright tests.

if [[ -n "${HTTP2_CADDY_LIB_SOURCED:-}" ]]; then
  return 0
fi
readonly HTTP2_CADDY_LIB_SOURCED=1

# shellcheck source=.ci/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"
# shellcheck source=.ci/pipelines/lib/common.sh
source "${DIR}/lib/common.sh"

# Resolve hostname to an IPv4 address (empty if not ready yet).
http2_caddy::resolve_ipv4() {
  local host="$1"
  local ip=""

  # Literal IP — nothing to resolve.
  if [[ "${host}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "${host}"
    return 0
  fi

  ip="$(getent ahostsv4 "${host}" 2> /dev/null | awk '{print $1; exit}')"
  if [[ -z "${ip}" ]] && command -v dig > /dev/null 2>&1; then
    ip="$(dig +short "${host}" A 2> /dev/null | awk '/^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$/{print; exit}')"
  fi
  if [[ -z "${ip}" ]] && command -v getent > /dev/null 2>&1; then
    ip="$(getent hosts "${host}" 2> /dev/null | awk '{print $1; exit}')"
  fi
  echo "${ip}"
}

# Wait until host resolves and TCP/443 accepts connections (NLB DNS lag).
http2_caddy::wait_for_endpoint() {
  local host="$1"
  local max_attempts="${2:-60}"
  local sleep_seconds="${3:-10}"
  local i
  local ip=""

  log::info "Waiting for ${host} to resolve and accept TCP/443 (up to $((max_attempts * sleep_seconds))s)"
  for ((i = 1; i <= max_attempts; i++)); do
    ip="$(http2_caddy::resolve_ipv4 "${host}")"
    if [[ -n "${ip}" ]]; then
      if timeout 5 bash -c "echo >/dev/tcp/${ip}/443" 2> /dev/null; then
        log::info "Endpoint ready: ${host} -> ${ip}:443 (attempt ${i}/${max_attempts})"
        echo "${ip}"
        return 0
      fi
      log::debug "Resolved ${host} -> ${ip} but :443 not ready yet (attempt ${i}/${max_attempts})"
    else
      log::debug "DNS for ${host} not ready yet (attempt ${i}/${max_attempts})"
    fi
    sleep "${sleep_seconds}"
  done

  log::error "Timed out waiting for ${host} to resolve and accept TCP/443"
  return 1
}

http2_caddy::deploy_and_verify() {
  local namespace="$1"
  local rhdh_service="$2"
  local caddy_host="${3:-rhdh-http2.ci.local}"
  local resources_dir="${DIR}/resources/http2-caddy"
  local cert_dir
  local rendered_manifest
  local rhdh_port
  local rhdh_url
  local external_host=""
  local ip=""
  local alpn=""
  local http2_ver=""
  local http11_ver=""
  local i
  local openssl_out=""

  common::require_vars "DIR" "ARTIFACT_DIR" || return 1

  if [[ ! -f "${resources_dir}/caddy.yaml" ]]; then
    log::error "Missing ${resources_dir}/caddy.yaml"
    return 1
  fi

  log::info "RHIDP-15792: deploying Caddy HTTP/2 proxy in namespace ${namespace}"

  # Discover backend Service port from the live Helm install (usually 7007).
  if ! kubectl get svc "${rhdh_service}" -n "${namespace}" > /dev/null 2>&1; then
    log::error "RHDH service ${rhdh_service} not found in ${namespace}"
    kubectl get svc -n "${namespace}" || true
    return 1
  fi
  rhdh_port="$(kubectl get svc "${rhdh_service}" -n "${namespace}" \
    -o jsonpath='{.spec.ports[?(@.name=="backend")].port}')"
  if [[ -z "${rhdh_port}" ]]; then
    rhdh_port="$(kubectl get svc "${rhdh_service}" -n "${namespace}" \
      -o jsonpath='{.spec.ports[0].port}')"
  fi
  rhdh_url="http://${rhdh_service}.${namespace}.svc.cluster.local:${rhdh_port}"
  log::info "Proxy backend: ${rhdh_url}"

  cert_dir="$(mktemp -d)"
  openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
    -keyout "${cert_dir}/tls.key" -out "${cert_dir}/tls.crt" \
    -subj "/CN=${caddy_host}" \
    -addext "subjectAltName=DNS:${caddy_host}" > /dev/null 2>&1

  kubectl -n "${namespace}" create secret tls tls-certs \
    --cert="${cert_dir}/tls.crt" --key="${cert_dir}/tls.key" \
    --dry-run=client -o yaml | kubectl apply -f -

  # Render live env into a temp manifest so the first pod never starts with placeholders.
  rendered_manifest="$(mktemp)"
  sed \
    -e "s|value: \"rhdh-developer-hub-namespace.apps.cluster.example.com\"|value: \"${caddy_host}\"|" \
    -e "s|value: \"http://backstage-developer-hub.namespace.svc.cluster.local:80\"|value: \"${rhdh_url}\"|" \
    "${resources_dir}/caddy.yaml" > "${rendered_manifest}"
  kubectl apply -n "${namespace}" -f "${rendered_manifest}"
  rm -f "${rendered_manifest}"

  if [[ -f "${resources_dir}/caddy-nlb-service.yaml" ]]; then
    kubectl apply -n "${namespace}" -f "${resources_dir}/caddy-nlb-service.yaml"
  fi

  kubectl -n "${namespace}" rollout status deployment/caddy-fronting-proxy --timeout=5m
  kubectl -n "${namespace}" logs -l app=caddy-fronting-proxy --tail=50 || true

  for ((i = 1; i <= 60; i++)); do
    external_host="$(kubectl -n "${namespace}" get svc caddy-nlb \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2> /dev/null)"
    if [[ -z "${external_host}" ]]; then
      external_host="$(kubectl -n "${namespace}" get svc caddy-nlb \
        -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2> /dev/null)"
    fi
    if [[ -n "${external_host}" ]]; then
      break
    fi
    log::debug "Waiting for caddy-nlb external address (attempt ${i}/60)..."
    sleep 10
  done

  if [[ -z "${external_host}" ]]; then
    log::error "caddy-nlb never received an external address"
    kubectl -n "${namespace}" get svc caddy-nlb -o yaml || true
    return 1
  fi
  log::info "Caddy front door endpoint: ${external_host}"

  # NLB hostname is often assigned before public DNS is ready — wait for resolve + :443.
  if ! ip="$(http2_caddy::wait_for_endpoint "${external_host}" 60 10)"; then
    return 1
  fi

  # Retry ALPN briefly in case the LB is still warming targets.
  for ((i = 1; i <= 12; i++)); do
    openssl_out="$(openssl s_client -connect "${ip}:443" -servername "${caddy_host}" \
      -alpn h2,http/1.1 < /dev/null 2>&1 || true)"
    alpn="$(echo "${openssl_out}" | awk '/ALPN protocol:/{print $3; exit}')"
    if [[ "${alpn}" == "h2" ]]; then
      break
    fi
    log::debug "ALPN not h2 yet (got '${alpn:-<none>}'), retry ${i}/12..."
    sleep 10
  done

  log::info "ALPN negotiated: ${alpn:-<none>}"
  if [[ "${alpn}" != "h2" ]]; then
    log::error "Expected ALPN protocol h2, got '${alpn}'"
    echo "${openssl_out}" | tail -40 || true
    return 1
  fi

  http2_ver="$(curl -sk --http2 --resolve "${caddy_host}:443:${ip}" \
    -o /dev/null -w '%{http_version}' "https://${caddy_host}/" || true)"
  log::info "curl --http2 http_version=${http2_ver}"
  if [[ "${http2_ver}" != "2" ]]; then
    log::error "Expected HTTP/2, got '${http2_ver}'"
    return 1
  fi

  http11_ver="$(curl -sk --http1.1 --resolve "${caddy_host}:443:${ip}" \
    -o /dev/null -w '%{http_version}' "https://${caddy_host}/" || true)"
  log::info "curl --http1.1 http_version=${http11_ver}"
  if [[ "${http11_ver}" != "1.1" ]]; then
    log::error "Expected HTTP/1.1 fallback, got '${http11_ver}'"
    return 1
  fi

  {
    echo "job=${JOB_NAME:-local}"
    echo "namespace=${namespace}"
    echo "rhdh_service=${rhdh_service}"
    echo "rhdh_url=${rhdh_url}"
    echo "caddy_host=${caddy_host}"
    echo "front_door=${external_host}"
    echo "resolved_ip=${ip}"
    echo "alpn=${alpn}"
    echo "http2=${http2_ver}"
    echo "http11=${http11_ver}"
    echo "caddy_image=$(kubectl -n "${namespace}" get deploy caddy-fronting-proxy -o jsonpath='{.spec.template.spec.containers[0].image}')"
  } | tee "${ARTIFACT_DIR}/http2-caddy-verify.txt"

  log::info "RHIDP-15792: HTTP/2 Caddy checks passed"
  return 0
}
