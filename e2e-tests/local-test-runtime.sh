#!/usr/bin/env bash

# Host tests target an existing deployment: require explicit namespaces rather
# than assuming that the CI defaults identify the caller's deployment.
test_runtime::validate_namespaces() {
  local pattern project variable namespace projects_json namespace_projects
  projects_json="$(cd "$(dirname "${BASH_SOURCE[0]}")/playwright" && pwd)/projects.json"
  namespace_projects=$(node -e '
    const projects = require(process.argv[1]);
    for (const key of ["SHOWCASE", "SHOWCASE_K8S", "SHOWCASE_OPERATOR",
      "SHOWCASE_RBAC", "SHOWCASE_RBAC_K8S", "SHOWCASE_OPERATOR_RBAC", "SHOWCASE_RUNTIME"]) {
      const variable = key.includes("RBAC") ? "NAME_SPACE_RBAC"
        : key === "SHOWCASE_RUNTIME" ? "NAME_SPACE_RUNTIME" : "NAME_SPACE";
      console.log(`${projects[key]}:${variable}`);
    }
  ' "$projects_json") || return 1
  for pattern in "$@"; do
    while IFS=: read -r project variable; do
      # Playwright accepts project glob patterns.
      # shellcheck disable=SC2053
      [[ "$project" == $pattern ]] || continue
      if [[ -z "${!variable:-}" ]]; then
        printf '%s is required for host project %s; set it to the deployed namespace.\n' "$variable" "$project" >&2
        return 1
      fi
      namespace=${!variable}
      if [[ ! "$namespace" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] \
        || [[ "${#namespace}" -gt 63 ]]; then
        printf 'Invalid Kubernetes namespace in %s.\n' "$variable" >&2
        return 1
      fi
      # shellcheck disable=SC2163
      export "$variable"
    done <<< "$namespace_projects"
  done
}
