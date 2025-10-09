#!/usr/bin/env bash
# Validation Module - ensure value files don't contain invalid placeholders

# Guard to prevent multiple sourcing
if [[ -n "${_VALIDATION_LOADED:-}" ]]; then
    return 0
fi
readonly _VALIDATION_LOADED=true

source "$(dirname "${BASH_SOURCE[0]}")/logging.sh"

# validate_value_files <directory-with-values>
validate_value_files() {
    local values_dir="$1"
    log_info "Validating Helm value files in ${values_dir}"

    # Find yaml files
    local bad_files=()
    while IFS= read -r -d '' file; do
        if grep -q "\\${\\.Values" "$file"; then
            bad_files+=("$file")
        fi
    done < <(find "$values_dir" -name "*.yaml" -print0)

    if [[ ${#bad_files[@]} -gt 0 ]]; then
        log_error "Invalid Helm placeholder detected in value files:"
        for f in "${bad_files[@]}"; do
            log_error "  - $f"
        done
        log_error "Replace \${.Values.*} with a concrete value or Helm template syntax {{ }}."
        return 1
    fi

    log_success "Value files validation passed"
}

export -f validate_value_files
