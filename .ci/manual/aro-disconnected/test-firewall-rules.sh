#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TEST_DIR"' EXIT

mkdir -p "$TEST_DIR/bin"
cp "$SCRIPT_DIR/create-azure-firewall-rules.sh" "$TEST_DIR/"

printf '%s\n' \
  'BASE_NAME=test' \
  'RESOURCEGROUP=test-rg' \
  'FIREWALL_NAME=test-firewall' \
  'FIREWALL_COLLECTION_NAME=azure_ms' > "$TEST_DIR/.env"

printf '%s\n' '#!/usr/bin/env bash' \
  'printf "%s\n" "$*" >> "${AZ_LOG}"' \
  'case "${1:-}:${2:-}:${3:-}:${4:-}:${5:-}" in' \
  '  account:show::::) exit 0 ;;' \
  '  network:firewall:show::::) exit 0 ;;' \
  '  network:firewall:application-rule:collection:show) exit 1 ;;' \
  '  network:firewall:application-rule:create:*) exit 0 ;;' \
  'esac' \
  'exit 0' > "$TEST_DIR/bin/az"
chmod +x "$TEST_DIR/bin/az"

PATH="$TEST_DIR/bin:$PATH" AZ_LOG="$TEST_DIR/az.log" \
  bash "$TEST_DIR/create-azure-firewall-rules.sh"

expected_rules=(
  azure
  redhat
  ms-graph
  github
  gitlab
  pagerduty
  quay
  okta
  auth0
  atlassian
  atlassian-third-party
)
create_count=0
first_create=''
while IFS= read -r line; do
  case "$line" in
    network\ firewall\ application-rule\ create\ *)
      create_count=$((create_count + 1))
      if [[ -z "$first_create" ]]; then
        first_create="$line"
      fi
      [[ "$line" == *'--collection-name azure_ms '* ]]
      ;;
  esac
done < "$TEST_DIR/az.log"

[[ "$create_count" -eq "${#expected_rules[@]}" ]]
[[ "$first_create" == *'--action Allow'*'--priority 200'* ]]

for rule_name in "${expected_rules[@]}"; do
  found=0
  while IFS= read -r line; do
    if [[ "$line" == *"--name $rule_name "* ]]; then
      found=1
      break
    fi
  done < "$TEST_DIR/az.log"
  [[ "$found" -eq 1 ]]
done

printf '%s\n' 'firewall rule iteration test passed'
