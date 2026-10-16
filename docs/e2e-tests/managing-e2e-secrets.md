# Managing E2E Secrets

Start with the [upstream Secrets API documentation](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html) for authentication, CLI usage, the FD 3 stream format, and secret lifecycle operations. This guide describes only the collection, naming conventions, entry points, and handling rules used by this repository.

## Repository Collection and Secret Names

Use the collection ID `rhdh-qe`. Two profiles select secrets by path:

| Secret path                                                                                                | Profile                                                                                                      | Loaded for                                 | Delivered as                                                                                         |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `rhdh/<NAME>`                                                                                              | [`e2e-tests/e2e-secrets.profile.json`](../../e2e-tests/e2e-secrets.profile.json)                             | `local-run.sh`, `local-test.sh`            | Container: file `/tmp/secrets/<NAME>`. Host: environment variable `<NAME>` of the Playwright process |
| `ephemeral_cluster/EPHEMERAL_CLUSTER_ADMIN_USERNAME`, `ephemeral_cluster/EPHEMERAL_CLUSTER_ADMIN_PASSWORD` | [`e2e-tests/ephemeral-cluster-secrets.profile.json`](../../e2e-tests/ephemeral-cluster-secrets.profile.json) | `.ci/pipelines/ocp-cluster-claim-login.sh` | Files in a private temporary directory, removed on exit                                              |

`<NAME>` is the field name OpenShift CI mounts under `/tmp/secrets` and that [`.ci/pipelines/env_variables.sh`](../../.ci/pipelines/env_variables.sh) reads. Keep that exact spelling: one name serves the Bitwarden path, the CI field, and the variable the tests read. The profiles contain selectors, not secret values, so adding a secret under an existing prefix needs no profile change.

The two database certificate items are the exception: either spelling of `azure_db_certificates_pem` is written as `azure-db-certificates.pem`, and supplying both spellings fails before any file is written. The stored RDS bundle is never used; both runners download the current public AWS RDS CA bundle instead.

Cloud SQL uses `rhdh/cloudsql_service_account_json` (or the GSM-encoded `cloudsql_service_account__dot__json`). Container runs materialize it as `/tmp/secrets/cloudsql-service-account.json`, matching the default `CLOUDSQL_SERVICE_ACCOUNT_JSON_PATH` in CI. Host runs write it to a private temporary file and set that path only in the test child environment. Supplying both aliases fails; the raw key is never exported as an environment variable.

## Running with Secrets

Complete the [upstream local-command prerequisites](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#local-command) — the `bw` CLI on `PATH` and an unlocked session — then run `yarn install` in `e2e-tests`, which provides the pinned `rhdh-e2e-secrets` executable. Set `RHDH_E2E_SECRETS_BIN` only to test a different CLI build.

| Goal                                                      | Command                                                                                       |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Deploy RHDH (and optionally test) in the runner container | `cd e2e-tests && ./local-run.sh`                                                              |
| Run Playwright on the host against an existing deployment | `cd e2e-tests && BASE_URL=<url> NAME_SPACE=<namespace> ./local-test.sh -- --project=showcase` |
| Log in to a cluster claimed by a CI job                   | `.ci/pipelines/ocp-cluster-claim-login.sh <prow-url>`                                         |

All three request the secret stream on file descriptor 3 (`--stream-secrets`), so selected values never enter the wrapper's own environment.

- **Container runs** decode the stream into a private tmpfs mounted at `/tmp/secrets`, the same path CI uses, and then run the unchanged CI entry point.
- **Host runs** load the values into the Playwright child environment only. Namespaces, `BASE_URL`, `K8S_CLUSTER_URL`, and `K8S_CLUSTER_TOKEN` always come from the caller; profile values for them, and cluster-admin credentials, are discarded.
- `local-run.sh` retrieves and validates the profile **before** it creates any cluster resource.

Host runs need the namespace variable of the selected project: `NAME_SPACE` (`showcase*`), `NAME_SPACE_RBAC` (`showcase-rbac*`), or `NAME_SPACE_RUNTIME` (`showcase-runtime`). `showcase-runtime` redeploys RHDH from the test process, so on the host it additionally needs `K8S_CLUSTER_URL`, `K8S_CLUSTER_TOKEN`, `POSTGRESQL_IMAGE_REGISTRY`, `POSTGRESQL_IMAGE_REPO`, `POSTGRESQL_IMAGE_TAG`, and — for Helm, the default when `JOB_NAME` is empty — `CHART_VERSION`. None of these come from Bitwarden. Prefer `local-run.sh` for that project.

### Early Bitwarden Checks and Recovery

Before doing anything else, each entry point checks that the pinned CLI exists and supports `--stream-secrets`, that `BW_SESSION` is exported and nonempty, and that the profile file exists. The scripts never log in or unlock the vault.

| Failure                                          | Next step                                                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Unable to find the pinned rhdh-e2e-secrets CLI` | Run `yarn install` in `e2e-tests`.                                                                                                                                                                                    |
| `rhdh-e2e-secrets must support --stream-secrets` | The installed `@red-hat-developer-hub/e2e-test-utils` is too old; reinstall the version pinned in `e2e-tests/package.json`.                                                                                           |
| `BW_SESSION is required`                         | Complete the [upstream local-command prerequisites](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#local-command) in the shell that launches the script.                                     |
| Secrets fail to load with a session set          | Check the session and collection access using the [upstream Secrets API guidance](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html).                                                           |
| `Another local run owns …/run.lock`              | Only one `local-run.sh` may run per checkout. After an uncatchable termination, confirm the previous runner has stopped, remove `e2e-tests/.local-test/run.lock/output`, then `rmdir e2e-tests/.local-test/run.lock`. |

For host cluster-token setup, CI-equivalent OCP Helm commands, and report locations, see the
[local runner README](../../e2e-tests/README.md#running-tests-locally-in-headed-mode-recommended-for-debugging).

## Creating, Rotating, and Removing Secrets

Follow the [upstream mutation procedures](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#mutations) with `--collection rhdh-qe` and a path from the table above. The shared tool updates the paired Bitwarden and Google Secret Manager (GSM) values together, and never accepts a value as a command-line literal.

For the provider-specific steps, use the upstream instructions for:

- [Google Secret Manager authentication](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#gsm-authentication).
- [Listing paths and inspecting metadata](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#gsm-read-commands).
- [Temporary secret files and cleanup](https://redhat-developer.github.io/rhdh-e2e-test-utils/api/secrets.html#temporary-secret-files).

For a newly required secret, create `rhdh/<NAME>`, then add `<NAME>=$(cat /tmp/secrets/<NAME>)` to `.ci/pipelines/env_variables.sh`. `yarn test:unit` in `e2e-tests` then checks that CI files and decoded Bitwarden files still produce the same environment.

## CI Compatibility

OpenShift CI mounts the `rhdh` credentials as individual files under `/tmp/secrets` and `env_variables.sh` reads them explicitly. Local container runs reproduce that directory, so they execute the original CI sourcing unchanged. Local runs populate nothing in CI, and CI never contacts Bitwarden.

Store each CI credential as its own raw GSM field so Prow knows which values to censor in public logs and artifacts; a secret-stored script or compound configuration is not a substitute. See the [OpenShift CI secret protection guidance](https://docs.ci.openshift.org/how-tos/adding-a-new-secret-to-ci-gsm/#protecting-secrets-from-leaking).

## Handling Rules

- Do not persist secrets in `.env` files or anywhere under the checkout.
- Keep runtime secret files outside `SHARED_DIR` (flat [cross-step state](https://docs.ci.openshift.org/architecture/step-registry/#sharing-data-between-steps)) and `ARTIFACT_DIR` (public artifacts). Locally, `SHARED_DIR` is inside the bind-mounted work copy, so anything written there stays on the host disk.
- Keep secret values out of process arguments and container environment flags; pass them on a file descriptor or as a private file.
- Keep shell tracing (`set -x`) off for secret-bearing commands, and never dump the test environment.
