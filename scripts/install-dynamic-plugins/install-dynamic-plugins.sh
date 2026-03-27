#!/usr/bin/env bash
#
# Copyright Red Hat, Inc.
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
# Dynamic Plugin Installer — bash + curl (Registry HTTP API v2). No Python/skopeo.
# Requires: bash 4+, curl, jq, openssl, npm, node, tar, gzip, sha256sum, base64, mktemp,
#           yq v4+ (https://github.com/mikefarah/yq) — set YQ=/path/to/yq if needed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
YQ_BIN="${YQ:-yq}"
NODE="${NODE:-node}"

DOCKER_PROTOCOL_PREFIX="docker://"
RHDH_REGISTRY_PREFIX="registry.access.redhat.com/rhdh/"
RHDH_FALLBACK_PREFIX="quay.io/rhdh/"
MAX_ENTRY_SIZE="${MAX_ENTRY_SIZE:-20000000}"
SKIP_INTEGRITY_CHECK="${SKIP_INTEGRITY_CHECK:-}"
CATALOG_INDEX_IMAGE="${CATALOG_INDEX_IMAGE:-}"
CATALOG_ENTITIES_EXTRACT_DIR="${CATALOG_ENTITIES_EXTRACT_DIR:-}"

OCI_TMP=""
LOCK_FILE=""

die() { echo "install-dynamic-plugins: $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"; }

check_yq() {
  need_cmd "$YQ_BIN"
  echo '{}' | "$YQ_BIN" eval -o=json - >/dev/null 2>&1 || die "yq v4+ (mikefarah) required: https://github.com/mikefarah/yq — set YQ="
}

yq_to_json() { "$YQ_BIN" eval -o=json "$1"; }

# --- registry (curl) ---------------------------------------------------------

registry_normalize() {
  local reg="$1"
  local repo="$2"
  if [[ "$reg" == "docker.io" ]]; then
    reg="registry-1.docker.io"
    if [[ "$repo" != */* ]]; then
      repo="library/$repo"
    fi
  fi
  printf '%s\n%s' "$reg" "$repo"
}

parse_auth_line() {
  local line="$1"
  local realm="" service="" scope=""
  [[ "$line" =~ realm=\"([^\"]+)\" ]] && realm="${BASH_REMATCH[1]}"
  [[ "$line" =~ service=\"([^\"]+)\" ]] && service="${BASH_REMATCH[1]}"
  [[ "$line" =~ scope=\"([^\"]+)\" ]] && scope="${BASH_REMATCH[1]}"
  printf '%s\t%s\t%s' "$realm" "$service" "$scope"
}

registry_curl() {
  local url="$1"
  local out="$2"
  local hdr="$3"
  shift 3
  curl -sS -L -D "$hdr" -o "$out" \
    -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json" \
    -H "Accept: application/vnd.oci.image.manifest.v1+json" \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    "$@" "$url"
}

http_code_from_hdr() { grep -i '^HTTP/' "$1" | tail -n1 | awk '{print $2}' | tr -d '\r'; }

registry_get_token() {
  local realm="$1"
  local service="$2"
  local scope="$3"
  local sep='?'
  [[ "$realm" == *\?* ]] && sep='&'
  local u="${realm}${sep}service=$(printf '%s' "$service" | jq -sRr @uri)&scope=$(printf '%s' "$scope" | jq -sRr @uri)"
  curl -sS "$u" | jq -r '.token // .access_token // empty'
}

# GET url with Bearer retry; prints HTTP status to stdout, body in $out
registry_get() {
  local url="$1"
  local out="$2"
  local hdr="$3"
  local tok="${4:-}"
  local extra=()
  [[ -n "$tok" ]] && extra=(-H "Authorization: Bearer ${tok}")
  registry_curl "$url" "$out" "$hdr" "${extra[@]}"
  local code
  code="$(http_code_from_hdr "$hdr")"
  if [[ "$code" == "401" ]]; then
    local auth line realm service scope
    line="$(grep -i '^www-authenticate:' "$hdr" | tr -d '\r' | head -n1)"
    line="${line#WWW-Authenticate: }"
    line="${line#www-authenticate: }"
    IFS=$'\t' read -r realm service scope <<<"$(parse_auth_line "$line")"
    [[ -n "$realm" ]] || { echo "$code"; return; }
    tok="$(registry_get_token "$realm" "$service" "$scope")"
    [[ -n "$tok" ]] || { echo "$code"; return; }
    registry_curl "$url" "$out" "$hdr" -H "Authorization: Bearer ${tok}"
    code="$(http_code_from_hdr "$hdr")"
  fi
  echo "$code"
}

registry_url() {
  local reg="$1"
  local repo="$2"
  local kind="$3"
  local ref="$4"
  mapfile -t _nr < <(registry_normalize "$reg" "$repo")
  reg="${_nr[0]}"
  repo="${_nr[1]}"
  local rpath
  rpath="$(printf '%s' "$repo" | jq -sRr @uri | sed 's|%2F|/|g')"
  local base="https://${reg}"
  if [[ "$kind" == "manifests" ]]; then
    echo "${base}/v2/${rpath}/manifests/${ref}"
  else
    echo "${base}/v2/${rpath}/blobs/${ref}"
  fi
}

# Returns manifest JSON on stdout; sets _MANIFEST_DIGEST from Docker-Content-Digest header when present
_MANIFEST_DIGEST=""
oci_fetch_manifest_resolved() {
  local reg="$1"
  local repo="$2"
  local ref="$3"
  local tmpd hdr body code url med
  tmpd="$(mktemp -d)"
  hdr="${tmpd}/h"
  body="${tmpd}/b"
  url="$(registry_url "$reg" "$repo" "manifests" "$ref")"
  code="$(registry_get "$url" "$body" "$hdr")"
  if [[ "$code" != "200" ]]; then
    rm -rf "$tmpd"
    die "registry GET $url failed with HTTP $code"
  fi
  _MANIFEST_DIGEST="$(grep -i '^docker-content-digest:' "$hdr" | tail -n1 | awk '{print $2}' | tr -d '\r')"
  med="$(jq -r '.mediaType // empty' "$body")"
  case "$med" in
    *manifest.list*|*image.index*)
      local dg
      dg="$(jq -r --arg os linux --arg arch amd64 '.manifests[]? | select(.platform.os==$os and .platform.architecture==$arch) | .digest' "$body" | head -n1)"
      [[ -n "$dg" ]] || die "no linux/amd64 entry in manifest index for $reg/$repo:$ref"
      rm -rf "$tmpd"
      tmpd="$(mktemp -d)"
      hdr="${tmpd}/h"
      body="${tmpd}/b"
      url="$(registry_url "$reg" "$repo" "manifests" "$dg")"
      code="$(registry_get "$url" "$body" "$hdr")"
      [[ "$code" == "200" ]] || die "registry GET manifest $dg failed HTTP $code"
      _MANIFEST_DIGEST="$(grep -i '^docker-content-digest:' "$hdr" | tail -n1 | awk '{print $2}' | tr -d '\r')"
      cat "$body"
      ;;
    *)
      cat "$body"
      ;;
  esac
  rm -rf "$tmpd"
}

oci_fetch_blob_to_file() {
  local reg="$1"
  local repo="$2"
  local digest="$3"
  local dest="$4"
  local url hdr tmpd code
  tmpd="$(mktemp -d)"
  hdr="${tmpd}/h"
  url="$(registry_url "$reg" "$repo" "blobs" "$digest")"
  code="$(registry_get "$url" "$dest" "$hdr")"
  rm -rf "$tmpd"
  [[ "$code" == "200" ]] || die "blob download failed HTTP $code for $digest"
}

resolve_image_reference() {
  local image="$1"
  local check="$image"
  local prefix=""
  if [[ "$check" == oci://* ]]; then check="${check#oci://}"; prefix="oci://"
  elif [[ "$check" == docker://* ]]; then check="${check#docker://}"; prefix="docker://"; fi
  if [[ "$check" != "$RHDH_REGISTRY_PREFIX"* ]]; then echo "$image"; return; fi
  echo $'\t==> Checking if image exists in '"$RHDH_REGISTRY_PREFIX" >&2
  local docker_url="${DOCKER_PROTOCOL_PREFIX}${check}"
  if image_exists_in_registry "$docker_url"; then
    echo $'\t==> Image found in '"$RHDH_REGISTRY_PREFIX" >&2
    echo "$image"
    return
  fi
  local fb="${check/#$RHDH_REGISTRY_PREFIX/$RHDH_FALLBACK_PREFIX}"
  echo $'\t==> Image not found in '"$RHDH_REGISTRY_PREFIX"', falling back to '"$RHDH_FALLBACK_PREFIX" >&2
  echo $'\t==> Using fallback image: '"$fb" >&2
  echo "${prefix}${fb}"
}

image_exists_in_registry() {
  local docker_url="$1"
  local img="${docker_url#docker://}"
  local reg repo ref
  if [[ "$img" == *@* ]]; then
    reg="${img%%/*}"
    local rest="${img#*/}"
    repo="${rest%%@*}"
    ref="${rest#*@}"
  else
    reg="${img%%/*}"
    local rest="${img#*/}"
    repo="${rest%%:*}"
    ref="${rest#*:}"
  fi
  local url hdr tmpd code
  tmpd="$(mktemp -d)"
  hdr="${tmpd}/h"
  url="$(registry_url "$reg" "$repo" "manifests" "$ref")"
  code="$(registry_get "$url" "/dev/null" "$hdr")"
  rm -rf "$tmpd"
  [[ "$code" == "200" ]]
}

# image: oci://... with tag or digest
get_oci_plugin_paths() {
  local image="$1"
  local resolved mj reg repo ref manifest ann raw dec
  resolved="$(resolve_image_reference "$image")"
  mj="$("$NODE" "${SCRIPT_DIR}/oci-ref.cjs" parse "$resolved")"
  reg="$(echo "$mj" | jq -r .registry)"
  repo="$(echo "$mj" | jq -r .repository)"
  ref="$(echo "$mj" | jq -r .reference)"
  manifest="$(oci_fetch_manifest_resolved "$reg" "$repo" "$ref")"
  ann="$(echo "$manifest" | jq -r '.annotations["io.backstage.dynamic-packages"] // empty')"
  [[ -n "$ann" ]] && {
    dec="$(printf '%s' "$ann" | base64 -d 2>/dev/null || true)"
    echo "$dec" | jq -r '.[] | objects | keys[]' 2>/dev/null || true
  }
}

oci_image_digest_hex() {
  local image="$1"
  local resolved mj reg repo ref
  resolved="$(resolve_image_reference "$image")"
  mj="$("$NODE" "${SCRIPT_DIR}/oci-ref.cjs" parse "$resolved")"
  reg="$(echo "$mj" | jq -r .registry)"
  repo="$(echo "$mj" | jq -r .repository)"
  ref="$(echo "$mj" | jq -r .reference)"
  oci_fetch_manifest_resolved "$reg" "$repo" "$ref" >/dev/null
  local d="${_MANIFEST_DIGEST:-}"
  [[ -n "$d" ]] || die "could not read manifest digest for $image"
  echo "${d#sha256:}"
}

oci_copy_image_layer0() {
  local image="$1"
  local out_dir="$2"
  local resolved mj reg repo ref manifest layer digest hashpart
  resolved="$(resolve_image_reference "$image")"
  echo $'\t==> Copying image '"$resolved"' to local filesystem (registry API)' >&2
  mj="$("$NODE" "${SCRIPT_DIR}/oci-ref.cjs" parse "$resolved")"
  reg="$(echo "$mj" | jq -r .registry)"
  repo="$(echo "$mj" | jq -r .repository)"
  ref="$(echo "$mj" | jq -r .reference)"
  manifest="$(oci_fetch_manifest_resolved "$reg" "$repo" "$ref")"
  mkdir -p "$out_dir"
  echo "$manifest" >"${out_dir}/manifest.json"
  layer="$(echo "$manifest" | jq -r '.layers[0].digest // empty')"
  [[ -n "$layer" ]] || die "OCI image has no layers: $image"
  hashpart="${layer#*:}"
  oci_fetch_blob_to_file "$reg" "$repo" "$layer" "${out_dir}/${hashpart}"
}

extract_npm_tgz() {
  local archive="$1"
  local dest_dir="$2"
  local first
  first="$(tar -tf "$archive" 2>/dev/null | head -1)"
  [[ "$first" == package/* ]] || die "NPM package archive does not start with 'package/' as it should: $first"
  tar -xzf "$archive" -C "$dest_dir" --strip-components=1
}

verify_integrity() {
  local pkg_json="$1"
  local archive="$2"
  local integ algo b64 got
  integ="$(echo "$pkg_json" | jq -r '.integrity // empty')"
  [[ -n "$integ" ]] || die "Package integrity missing"
  algo="${integ%%-*}"
  b64="${integ#*-}"
  case "$algo" in sha512|sha384|sha256) ;; *) die "unsupported integrity algorithm $algo" ;; esac
  printf '%s' "$b64" | base64 -d >/dev/null 2>&1 || die "integrity hash is not valid base64"
  got="$(openssl dgst "-$algo" -binary <"$archive" | openssl base64 -A | tr -d '\n')"
  [[ "$got" == "$b64" ]] || die "integrity hash mismatch for $(echo "$pkg_json" | jq -r .package)"
}

maybe_merge_config() {
  local frag="$1"
  local global="$2"
  [[ -z "$frag" || "$frag" == "{}" || "$frag" == "null" ]] && { echo "$global"; return; }
  echo $'\t==> Merging plugin-specific configuration' >&2
  "$NODE" "${SCRIPT_DIR}/merge-app-config.cjs" "$global" "$frag"
}

compute_plugin_hash() {
  local p="$1"
  local pkg base
  pkg="$(echo "$p" | jq -r .package)"
  base="$(echo "$p" | jq -c 'del(.pluginConfig)|del(.version)|del(.plugin_hash)')"
  if [[ "$pkg" == ./* ]]; then
    local info
    info="$(get_local_package_info "$pkg")"
    base="$(echo "$base" | jq --argjson i "$info" '. + {_local_package_info: $i}')"
  fi
  echo -n "$base" | "$NODE" "${SCRIPT_DIR}/compute-plugin-hash.cjs"
}

get_local_package_info() {
  local package_path="$1"
  local abs
  abs="$(pwd)/${package_path#./}"
  if [[ ! -f "${abs}/package.json" ]]; then
    if [[ -d "$abs" ]]; then
      local mt
      mt="$(stat -c %Y "$abs" 2>/dev/null || stat -f %m "$abs")"
      echo "{\"_directory_mtime\":$mt}"
    else
      echo '{"_not_found":true}'
    fi
    return
  fi
  local pj m out
  pj="$(jq -c . "${abs}/package.json" 2>/dev/null || echo '{}')"
  m="$(stat -c %Y "${abs}/package.json" 2>/dev/null || stat -f %m "${abs}/package.json")"
  out="$(jq -n --argjson pj "$pj" --argjson m "$m" '{_package_json: $pj, _package_json_mtime: $m}')"
  if [[ -f "${abs}/package-lock.json" ]]; then
    local lm
    lm="$(stat -c %Y "${abs}/package-lock.json" 2>/dev/null || stat -f %m "${abs}/package-lock.json")"
    out="$(echo "$out" | jq --argjson lm "$lm" '. + {_package_lock_json_mtime: $lm}')"
  fi
  if [[ -f "${abs}/yarn.lock" ]]; then
    local ym
    ym="$(stat -c %Y "${abs}/yarn.lock" 2>/dev/null || stat -f %m "${abs}/yarn.lock")"
    out="$(echo "$out" | jq --argjson ym "$ym" '. + {_yarn_lock_mtime: $ym}')"
  fi
  echo "$out"
}

# --- catalog index (same layout as Python) -----------------------------------

extract_catalog_index() {
  local catalog_image="$1"
  local mount_root="$2"
  local entities_parent="$3"
  echo $'\n======= Extracting catalog index from '"$catalog_image"
  local tmp
  tmp="$(mktemp -d)"
  oci_copy_image_layer0 "$catalog_image" "${tmp}/oci"
  [[ -f "${tmp}/oci/manifest.json" ]] || die "manifest.json not found in catalog index image"
  local catalog_temp="${mount_root}/.catalog-index-temp"
  mkdir -p "$catalog_temp"
  local manifest layer fn
  manifest="${tmp}/oci/manifest.json"
  echo $'\t==> Extracting catalog index layers'
  mapfile -t layers < <(jq -r '.layers[]?.digest // empty' "$manifest")
  for layer in "${layers[@]}"; do
    [[ -z "$layer" ]] && continue
    fn="${layer#*:}"
    [[ -f "${tmp}/oci/$fn" ]] || continue
    echo $'\t==> Extracting layer '"$fn"
    while IFS= read -r tline; do
      local sz="${tline%% *}"
      local pth="${tline#* }"
      [[ "$sz" =~ ^[0-9]+$ ]] || continue
      if (( sz > MAX_ENTRY_SIZE )); then
        echo $'\t==> WARNING: Skipping large file '"$pth"' in catalog index'
        continue
      fi
    done < <(tar -tvf "${tmp}/oci/$fn" 2>/dev/null | awk '{print $3" "$NF}' || true)
    tar -xf "${tmp}/oci/$fn" -C "$catalog_temp" || true
  done
  rm -rf "$tmp"
  local default_yaml="${catalog_temp}/dynamic-plugins.default.yaml"
  [[ -f "$default_yaml" ]] || die "Catalog index image does not contain dynamic-plugins.default.yaml"
  echo $'\t==> Successfully extracted dynamic-plugins.default.yaml from catalog index image'
  echo $'\t==> Extracting extensions catalog entities to '"$entities_parent"
  mkdir -p "$entities_parent"
  local extdir="${catalog_temp}/catalog-entities/extensions"
  local mktdir="${catalog_temp}/catalog-entities/marketplace"
  local src=""
  if [[ -d "$extdir" ]]; then src="$extdir"
  elif [[ -d "$mktdir" ]]; then src="$mktdir"; fi
  if [[ -n "$src" ]]; then
    rm -rf "${entities_parent}/catalog-entities"
    mkdir -p "${entities_parent}/catalog-entities"
    cp -a "$src/." "${entities_parent}/catalog-entities/"
    echo $'\t==> Successfully extracted extensions catalog entities from index image'
  else
    echo $'\t==> WARNING: Catalog index image does not have neither '\''catalog-entities/extensions/'\'' nor '\''catalog-entities/marketplace/'\'' directory' >&2
  fi
  echo "$default_yaml"
}

cleanup_oci_tmp() { [[ -n "${OCI_TMP:-}" && -d "$OCI_TMP" ]] && rm -rf "$OCI_TMP"; }
cleanup_lock() {
  flock -u 200 2>/dev/null || true
  exec 200>&- 2>/dev/null || true
  [[ -n "$LOCK_FILE" && -f "$LOCK_FILE" ]] && rm -f "$LOCK_FILE" 2>/dev/null && echo "======= Removed lock file: $LOCK_FILE" || true
}
cleanup_catalog() {
  local root="$1"
  [[ -d "${root}/.catalog-index-temp" ]] && rm -rf "${root}/.catalog-index-temp" && echo $'\n======= Cleaning up temporary catalog index directory' || true
}

trap 'cleanup_lock; cleanup_oci_tmp' EXIT
trap 'exit 0' TERM

# --- install steps -----------------------------------------------------------

declare -A OCI_TAR_CACHE=()

oci_get_layer_tarball() {
  local image="$1"
  local key hdir
  key="$(echo -n "$image" | sha256sum | awk '{print $1}')"
  if [[ -n "${OCI_TAR_CACHE[$key]:-}" ]]; then
    echo "${OCI_TAR_CACHE[$key]}"
    return
  fi
  hdir="${OCI_TMP}/oci-${key}"
  mkdir -p "$hdir"
  oci_copy_image_layer0 "$image" "$hdir"
  local mf layer hp
  mf="${hdir}/manifest.json"
  layer="$(jq -r '.layers[0].digest' "$mf")"
  hp="${layer#*:}"
  OCI_TAR_CACHE[$key]="${hdir}/${hp}"
  echo "${hdir}/${hp}"
}

should_skip_oci() {
  local plugin_json="$1"
  local dest="$2"
  local -n _pbh=$3
  local ph pkg policy path_ digest_file remote
  ph="$(echo "$plugin_json" | jq -r .plugin_hash)"
  pkg="$(echo "$plugin_json" | jq -r .package)"
  if echo "$plugin_json" | jq -e 'has("pullPolicy")' >/dev/null 2>&1; then
    policy="$(echo "$plugin_json" | jq -r .pullPolicy)"
  else
    if [[ "$pkg" == *':latest!'* ]]; then policy="Always"; else policy="IfNotPresent"; fi
  fi
  [[ -z "${_pbh[$ph]:-}" ]] && { echo "install"; return; }
  if [[ "$policy" == "IfNotPresent" ]]; then
    echo "skip"
    return
  fi
  [[ "$pkg" != *'!'* ]] && { echo "install"; return; }
  path_="${pkg#*!}"
  digest_file="${dest}/${path_}/dynamic-plugin-image.hash"
  remote="$(oci_image_digest_hex "${pkg%%!*}")"
  if [[ -f "$digest_file" ]] && [[ "$(cat "$digest_file")" == "$remote" ]]; then
    echo "skip"
    return
  fi
  echo "install"
}

should_skip_npm() {
  local plugin_json="$1"
  local -n _pbh=$2
  local ph policy force
  ph="$(echo "$plugin_json" | jq -r .plugin_hash)"
  [[ -z "${_pbh[$ph]:-}" ]] && { echo "install"; return; }
  policy="$(echo "$plugin_json" | jq -r '.pullPolicy // "IfNotPresent"')"
  force="$(echo "$plugin_json" | jq -r '.forceDownload // false')"
  [[ "$force" == "true" ]] && { echo "install"; return; }
  [[ "$policy" == "Always" ]] && { echo "install"; return; }
  echo "skip"
}

install_one_plugin() {
  local dest="$1"
  local plugin_json="$2"
  local skip_int="$3"
  local -n byhash="$4"
  local pkg ph path_out
  pkg="$(echo "$plugin_json" | jq -r .package)"
  ph="$(echo "$plugin_json" | jq -r .plugin_hash)"

  if [[ "$(echo "$plugin_json" | jq -r .disabled)" == "true" ]]; then
    echo $'\n======= Skipping disabled dynamic plugin '"$pkg" >&2
    echo "{}"
    return
  fi

  local sk
  if [[ "$pkg" == oci://* ]]; then
    sk="$(should_skip_oci "$plugin_json" "$dest" "$4")"
  else
    sk="$(should_skip_npm "$plugin_json" "$4")"
  fi
  if [[ "$sk" == "skip" ]]; then
    echo $'\n======= Skipping download of already installed dynamic plugin '"$pkg" >&2
    unset "byhash[$ph]" 2>/dev/null || true
    echo "$(echo "$plugin_json" | jq -c '.pluginConfig // {}')"
    return
  fi

  echo $'\n======= Installing dynamic plugin '"$pkg" >&2
  if [[ "$pkg" == oci://* ]]; then
    local img plugin_path tarb
    img="${pkg%%!*}"
    plugin_path="${pkg#*!}"
    [[ "$pkg" == *'!'* ]] || die "OCI package must resolve with !path: $pkg"
    tarb="$(oci_get_layer_tarball "$img")"
    local pdir="${dest}/${plugin_path}"
    [[ -d "$pdir" ]] && rm -rf "$pdir"
    mkdir -p "$dest"
    mapfile -t _oci_members < <(tar -tf "$tarb" | grep "^${plugin_path}" || true)
    if [[ ${#_oci_members[@]} -gt 0 ]]; then
      tar -xf "$tarb" -C "$dest" "${_oci_members[@]}"
    fi
    local dg
    dg="$(oci_image_digest_hex "$img")"
    mkdir -p "$pdir"
    echo -n "$dg" >"${pdir}/dynamic-plugin-image.hash"
    path_out="$plugin_path"
  else
    local pack_arg="$pkg"
    [[ "$pack_arg" == ./* ]] && pack_arg="$(pwd)/${pack_arg#./}"
    if [[ "$pkg" != ./* ]] && [[ "$skip_int" != "true" ]]; then
      echo "$plugin_json" | jq -e '.integrity' >/dev/null 2>&1 || die "No integrity hash provided for Package $pkg"
    fi
    echo $'\t==> Grabbing package archive through `npm pack`' >&2
    (cd "$dest" && npm pack "$pack_arg" >"${OCI_TMP}/np.out")
    local archive
    archive="$(tr -d '\r\n' <"${OCI_TMP}/np.out")"
    archive="${dest}/${archive}"
    if [[ "$pkg" != ./* ]] && [[ "$skip_int" != "true" ]]; then
      echo $'\t==> Verifying package integrity' >&2
      verify_integrity "$plugin_json" "$archive"
    fi
    local base_name
    base_name="$(basename "$archive" .tgz)"
    local extract_to="${dest}/${base_name}"
    [[ -d "$extract_to" ]] && rm -rf "$extract_to"
    mkdir -p "$extract_to"
    echo $'\t==> Extracting package archive '"$archive" >&2
    extract_npm_tgz "$archive" "$extract_to"
    echo $'\t==> Removing package archive '"$archive" >&2
    rm -f "$archive"
    path_out="$base_name"
  fi

  echo -n "$ph" >"${dest}/${path_out}/dynamic-plugin-config.hash"
  echo $'\t==> Successfully installed dynamic plugin '"$pkg" >&2
  for k in "${!byhash[@]}"; do
    [[ "${byhash[$k]}" == "$path_out" ]] && unset "byhash[$k]"
  done
  echo "$(echo "$plugin_json" | jq -c '.pluginConfig // {}')"
}

run_main() {
  local dynamic_plugins_root="$1"
  need_cmd curl
  need_cmd jq
  need_cmd openssl
  need_cmd npm
  need_cmd "$NODE"
  need_cmd flock
  check_yq

  OCI_TMP="$(mktemp -d)"
  mkdir -p "$dynamic_plugins_root"
  # flock(1) on a file — kernel releases when process exits (no stale mkdir dirs)
  LOCK_FILE="${dynamic_plugins_root}/.install-dynamic-plugins.flock"
  exec 200>>"$LOCK_FILE"
  echo "======= Acquiring lock $LOCK_FILE" >&2
  flock 200
  echo "======= Created lock file: $LOCK_FILE"

  local catalog_default=""
  if [[ -n "$CATALOG_INDEX_IMAGE" ]]; then
    local ent_parent="${CATALOG_ENTITIES_EXTRACT_DIR:-}"
    [[ -n "$ent_parent" ]] || ent_parent="${TMPDIR:-/tmp}/extensions"
    catalog_default="$(extract_catalog_index "$CATALOG_INDEX_IMAGE" "$dynamic_plugins_root" "$ent_parent")"
  fi

  local skip_int="false"
  [[ "${SKIP_INTEGRITY_CHECK,,}" == "true" ]] && skip_int="true"

  local dyn_file="dynamic-plugins.yaml"
  local global_out="${dynamic_plugins_root}/app-config.dynamic-plugins.yaml"

  if [[ ! -f "$dyn_file" ]]; then
    echo "No ${dyn_file} file found. Skipping dynamic plugins installation."
    : >"$global_out"
    exit 0
  fi

  local raw
  local content_json
  content_json="$(yq_to_json "$dyn_file" 2>/dev/null || echo '{}')"
  if [[ "$content_json" == "{}" ]] || [[ "$content_json" == "null" ]]; then
    echo "${dyn_file} file is empty. Skipping dynamic plugins installation."
    : >"$global_out"
    exit 0
  fi

  if [[ "$skip_int" == "true" ]]; then
    echo "SKIP_INTEGRITY_CHECK has been set to true, skipping integrity check of remote NPM packages"
  fi

  local merged
  merged="$("$NODE" "${SCRIPT_DIR}/merge-dynamic-plugins.cjs" "$dyn_file" "${catalog_default:-}")"

  local global
  global="$(jq -n '{dynamicPlugins: {rootDirectory: "dynamic-plugins-root"}}')"

  declare -A PLUGIN_PATH_BY_HASH=()
  local d h
  for d in "${dynamic_plugins_root}"/*; do
    [[ -d "$d" ]] || continue
    h="${d}/dynamic-plugin-config.hash"
    [[ -f "$h" ]] && PLUGIN_PATH_BY_HASH["$(cat "$h")"]="$(basename "$d")"
  done

  while IFS= read -r pjson; do
    local ph cfg
    ph="$(compute_plugin_hash "$pjson")"
    pjson="$(echo "$pjson" | jq --arg h "$ph" '. + {plugin_hash: $h}')"
    cfg="$(install_one_plugin "$dynamic_plugins_root" "$pjson" "$skip_int" PLUGIN_PATH_BY_HASH)"
    [[ "$cfg" != "{}" ]] && [[ -n "$cfg" ]] && global="$(maybe_merge_config "$cfg" "$global")"
  done < <(echo "$merged" | jq -c '.[]')

  echo "$global" | "$YQ_BIN" eval -P - >"$global_out"

  for h in "${!PLUGIN_PATH_BY_HASH[@]}"; do
    echo $'\n======= Removing previously installed dynamic plugin '"${PLUGIN_PATH_BY_HASH[$h]}"
    rm -rf "${dynamic_plugins_root}/${PLUGIN_PATH_BY_HASH[$h]}"
  done

  cleanup_catalog "$dynamic_plugins_root"
}

# Internal: used by merge-dynamic-plugins.cjs for OCI manifest annotation paths
if [[ "${1:-}" == "--get-oci-paths" ]]; then
  need_cmd curl
  need_cmd jq
  need_cmd "$NODE"
  shift
  get_oci_plugin_paths "${1:-}"
  exit 0
fi

[[ $# -ge 1 ]] || die "usage: $0 <dynamic-plugins-root>"
run_main "$1"
