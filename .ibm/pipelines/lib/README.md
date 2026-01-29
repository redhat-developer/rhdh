# Pipeline Library Modules

Utility functions organized by responsibility. See `../README.md` for development guidelines.

## Modules

### `log.sh`

Structured logging with ANSI colors.

Functions: `log::info`, `log::warn`, `log::error`, `log::success`, `log::debug`, `log::hr`

### `common.sh`

Common utilities.

Functions: `common::oc_login`, `common::sed_inplace`, `common::get_previous_release_version`

### `k8s-wait.sh`

Kubernetes wait/polling operations.

Functions: `k8s_wait::deployment`, `k8s_wait::job`, `k8s_wait::service`, `k8s_wait::endpoint`,
`k8s_wait::backstage_resource`

### `operators.sh`

Operator and OLM installations.

Functions: `operator::install_subscription`, `operator::check_status`,
`operator::install_postgres_ocp`, `operator::install_postgres_k8s`,
`operator::install_serverless_logic`, `operator::install_serverless`, `operator::install_pipelines`,
`operator::install_tekton`, `operator::delete_tekton`, `operator::install_olm`,
`operator::uninstall_olm`

### `helm.sh`

Helm chart operations and value file manipulation.

Functions: `helm::merge_values`, `helm::get_previous_release_values`, `helm::get_chart_version`,
`helm::uninstall`, `helm::get_image_params`, `helm::install`

### `orchestrator.sh`

Orchestrator/Sonataflow deployment and configuration.

Functions: `orchestrator::should_skip`, `orchestrator::disable_plugins_in_values`,
`orchestrator::deploy_workflows`, `orchestrator::deploy_workflows_operator`,
`orchestrator::enable_plugins_op`

## Creating New Modules

### Structure

```bash
#!/usr/bin/env bash

# Module: <module_name>
# Description: <brief description>
# Dependencies: <tools required>

# Function: namespace::function_name
# Arguments:
#   $1 - param: description
# Returns:
#   0 - Success
#   1 - Failure
namespace::function_name() {
  local param=$1

  if [[ -z "$param" ]]; then
    log::error "Missing parameter"
    return 1
  fi

  # Implementation
}
```

### Conventions

- **Files**: kebab-case (`k8s-wait.sh`)
- **Functions**: `namespace::function_name` (`k8s_wait::deployment`)
- **Private**: Underscore prefix (`_namespace::helper`)
- Validate inputs
- Log errors before returning

### Workflow

1. Create new file in `lib/`
2. Follow structure above
3. Add to `utils.sh` imports
4. Update call sites
5. Run linting:
   ```bash
   cd .ibm
   yarn prettier:fix
   yarn shellcheck
   ```
