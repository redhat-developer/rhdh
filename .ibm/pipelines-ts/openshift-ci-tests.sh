#!/bin/bash

# openshift-ci-tests.sh - Wrapper para o pipeline TypeScript
# 
# Este script mantém compatibilidade total com o pipeline CI existente
# enquanto redireciona a execução para a implementação TypeScript

set -e
export PS4='[$(date "+%Y-%m-%d %H:%M:%S")] '

# Diretório do script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "================================================================"
echo "RHDH Pipeline - Executando implementação TypeScript"
echo "================================================================"
echo "JOB_NAME: $JOB_NAME"
echo "Workspace: $(pwd)"
echo "Script Dir: $DIR"

# Verificar se o JOB_NAME está definido (apenas se não for comando de ajuda)
if [[ "$*" != *"--"* ]] && [[ -z "$JOB_NAME" ]]; then
    echo "ERROR: JOB_NAME environment variable is required"
    exit 1
fi

# Navegar para o diretório do pipeline TypeScript
cd "$DIR"

# Instalar dependências se necessário
if [[ ! -d "node_modules" ]]; then
    echo "Installing dependencies..."
    npm install
fi

# Executar o pipeline TypeScript
echo "Executing TypeScript pipeline..."

# Verificar se é um comando de help ou informação
case "${1:-}" in
    --help|-h|--list-jobs|-l|--job-info)
        npx tsx openshift-ci-tests.ts "$@"
        ;;
    *)
        # Execução normal com JOB_NAME
        if [[ -z "$JOB_NAME" ]]; then
            echo "ERROR: JOB_NAME environment variable is required"
            echo "Run with --help for usage information"
            exit 1
        fi
        npx tsx openshift-ci-tests.ts "$@"
        ;;
esac

# O código de saída será propagado automaticamente 