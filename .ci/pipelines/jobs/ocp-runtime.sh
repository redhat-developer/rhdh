#!/bin/bash

if [[ -n "${OCP_RUNTIME_JOBS_SOURCED:-}" ]]; then
  return 0
fi
readonly OCP_RUNTIME_JOBS_SOURCED=1

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

handle_ocp_helm_runtime() {
  export INSTALL_METHOD="helm"
  run_ocp_runtime_tests
}

handle_ocp_operator_runtime() {
  export INSTALL_METHOD="operator"
  run_ocp_runtime_tests
}

run_ocp_runtime_tests() {
  export NAME_SPACE_RUNTIME="${NAME_SPACE_RUNTIME:-showcase-runtime}"

  common::oc_login

  K8S_CLUSTER_ROUTER_BASE=$(oc get route console -n openshift-console -o=jsonpath='{.spec.host}' | sed 's/^[^.]*\.//')
  export K8S_CLUSTER_ROUTER_BASE

  if [[ "${INSTALL_METHOD}" == "operator" ]]; then
    prepare_operator
  fi

  # global-setup.ts deploys the runtime instance with internal PostgreSQL and
  # configures schema-mode port-forwarding. External database fixtures deploy
  # their own targets; no standard showcase or Crunchy deployment is needed.
  # Pass no URL: run_tests clears BASE_URL so RUNTIME_AUTO_DEPLOY can take the
  # deploy branch instead of waiting on a route that does not exist yet.
  export RUNTIME_AUTO_DEPLOY="true"
  # run_tests records failures in OVERALL_RESULT and publishes runtime artifacts.
  testing::run_tests "${RELEASE_NAME}" "${NAME_SPACE_RUNTIME}" "${PW_PROJECT_SHOWCASE_RUNTIME}" || true
}
