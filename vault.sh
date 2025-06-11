#!/bin/bash
set -e  # Para o script em caso de erro
set -a  # Exporta automaticamente variáveis

VAULT_ADDR="https://vault.ci.openshift.org"
VAULT_TOKEN='hvs.CAESINcrvnQlOYnqBdImt-WtuZivMACzb-288J3dRybO44VsGh4KHGh2cy5QQlRXMzgyMTVYYTFLV2EwTGlLZE1IWUg'
VAULT_SECRET_PATH="kv/selfservice/rhdh-qe/rhdh"
SECRETS_DIR="/tmp/secrets"

# Criar diretório base, se não existir
mkdir -p "$SECRETS_DIR"

echo "Fetching secrets from Vault at $VAULT_SECRET_PATH..."

# Obtém os secrets em formato JSON
SECRETS_JSON=$(vault kv get -format=json "$VAULT_SECRET_PATH" | jq -r '.data.data')

if [ -z "$SECRETS_JSON" ]; then
    echo "Error: Failed to retrieve secrets from Vault."
    exit 1
fi

# Percorre cada secret e salva em arquivos separados corretamente
echo "$SECRETS_JSON" | jq -r 'to_entries | .[] | "\(.key)"' | while read -r key; do
    value=$(echo "$SECRETS_JSON" | jq -r --arg key "$key" '.[$key]')

    # Corrige nomes de arquivos substituindo `/` por `_`
    safe_key=$(echo "$key" | tr '/' '_')
    SECRET_FILE="$SECRETS_DIR/$safe_key"

    # Usa printf para evitar problemas com quebras de linha
    printf "%s" "$value" > "$SECRET_FILE"

    chmod 600 "$SECRET_FILE"
    echo "Secret saved: $SECRET_FILE"
done

echo "All secrets have been successfully fetched and stored in $SECRETS_DIR.";

# Define os novos valores
NEW_GITHUB_APP_APP_ID="390890"
NEW_GITHUB_APP_CLIENT_ID="Iv1.f4dad420b287abbc"
NEW_GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA42p0yx46srQz5MDVwY8iA4KvBZGje5cHfLcvUmSlLbCeuYLI
OH1JC3ESsD4q+gGZH0sDfOSBZWoxxbUnnkmaMARA30mPX32GjpfFdTz2BkJfmmfI
ANq9bD5JLR1vBPoeF00jFvSyrivb4Xi5Aee5pGPiE2Qcrl2BL+a9i4iztarFxlzb
uth5SQiWO03u7foXn3HG2YHgRQEzEZTl20Ucsrp14MiQqiAXXobhg4hF4y1Ts8ag
K0+NN7y3ifHSWBXWKbdBDMRmlY+KlEtPdtdnMZxkg2vFa+0xblW7FgNy4iYKcfT6
W2Ij7QttQPFw5RU7h1rfo6qW1yfL2gM/YkQURQIDAQABAoIBAQCbpul5fJ9AYQaD
s1iaupTVQkT40s3KcXy2Z8sD4c8Mjq6U2magA2BTbHkWF/biVuWu/XDNsri96QlY
AL21ITtfUgn0yixPd2L5hfeoXqklb5hv3kiODSlJRPhg4Jx0E5005Z72v1Ts0SgW
EsLOAwSU96htDUB0N5uMZammL1KRK56dDfM4CybrblKvlfrb2T8rOBQXWHFxapZE
48cks3GD6Q1yHNXurM+BhGnudEYuAT/HG4qdnKy0EGeFFvG/OvxAOQplJCX2lKt6
JS546ew++aEIwqut9RUARY48f6yByVWpkb9IbjQjgOnV2syL1+aVv630X0ifxZS/
MdODn9UBAoGBAP6XmUS5n2lk3h9XmSzgF5D9A9GQ2RcIBIRIEgt94mnMhtgn1+1f
shTXFscIwUALfPTV0zmLjeFwnuK+ci/kc1/pnIgqIQNruj6IkyHh2hncnprd4pJg
WjDhGkm1RPSMaPccJ+rGU/zupjmLk6vjg/ECQTlC8C0BlS5Q7I33eGLpAoGBAOSs
YvpGZyLY287KovAQ91QRA/3e5C5+zT8ogxqaDJl4ytM28N2qkXNEKZbJru9dveXT
4yMXJ3kvdbNvDS23dEhYuqT9OBM/af2ouxi6PlWLkFjnw27C4jNWbc+xqR7EGri8
E5itrcoeAcaYQZXZl5PzPDyohF9Wp+lYSgq8uzT9AoGAJQB5iTCFR7ceRWXg4FHN
ewga5vlrY9qJdYRYAw2Pu5q7Om1IB7rx0e+U4uaV164Twi3VnjZ3L33DyeauB+Hn
FtiIJI4i8DFXB0GoSLNflISpFI8NIAMa+KGuxWmwFO7XTprr/kZG7Kruw8xScRgH
FB8kxaLB73icavfd+aAvAgkCgYAMTK1iMsk3WZyxCbsr2G3FKskhLYzuZ0mY3Q/4
LVMCKjoWlDzuX09FeOQXxS9QlqUxKG1uJL+tx/y3swBtdhGeFo+rcidC+cU0rI+r
q9DQfxo7ffPIEFlkU4DCjBbBneCmEQ+oxaa0WVrVGLlmWvbJMWsLBDFig2GyrloF
K9OR7QKBgQCQnPcTOaScAZIjDrJ65k6AozbYqqbm/v3Z8cqdfTETkl68ht/z0Z54
UdL6uZr8rlfEtDOa8Gk8z4Eyjcz8E2jhr4oKrQS6BnhSmGcx8ZlAKY4YykPvmiBn
RqKjXvFbBZ5PitYlF6vYayoszxFKLpv5SkQ8OTHAqAmvBXDLbrKkLA==
-----END RSA PRIVATE KEY-----"
NEW_GITHUB_APP_CLIENT_SECRET="c80a966afdfa321cf1d40f5f185bbd35b13d00f2"

# Salva os novos valores codificados em base64
echo -n "$NEW_GITHUB_APP_APP_ID" | base64 > "$SECRETS_DIR/GITHUB_APP_APP_ID"
echo -n "$NEW_GITHUB_APP_CLIENT_ID" | base64 > "$SECRETS_DIR/GITHUB_APP_CLIENT_ID"
echo -n "$NEW_GITHUB_APP_PRIVATE_KEY" | base64 > "$SECRETS_DIR/GITHUB_APP_PRIVATE_KEY"
echo -n "$NEW_GITHUB_APP_CLIENT_SECRET" | base64 > "$SECRETS_DIR/GITHUB_APP_CLIENT_SECRET"

echo "Updated specific secrets with new values."
