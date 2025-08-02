#!/bin/bash

# Script para fazer commit das correções do build skip logic
echo "🔧 Fazendo commit das correções do build skip logic..."

# Verificar se há mudanças para commitar
if ! git diff --cached --quiet; then
    echo "⚠️  Há mudanças já staged. Execute git status para verificar."
    exit 1
fi

# Adicionar os arquivos modificados
echo "📁 Adicionando arquivos modificados..."
git add .github/workflows/pr-build-image.yaml
git add .github/actions/check-image-and-changes/action.yaml
git add scripts/test-build-skip-logic.sh
git add docs/ci-build-skip-logic.md
git add docs/SOLUCAO-PR-3093.md

# Verificar se há mudanças para commitar
if git diff --cached --quiet; then
    echo "❌ Nenhuma mudança detectada para commit."
    exit 1
fi

echo "📋 Arquivos que serão commitados:"
git diff --cached --name-only

echo ""
echo "📝 Mensagem do commit:"
COMMIT_MSG="fix(ci): improve build skip logic for documentation PRs

- Enhanced paths-ignore in pr-build-image.yaml workflow
- Improved check-image-and-changes action with better debugging
- Added multiple layers of protection for skipping unnecessary builds
- Created test script for local debugging
- Added comprehensive documentation

Fixes issue where documentation-only PRs were executing builds
unnecessarily, particularly affecting PR #3093 which only modified
docs/e2e-tests/enhanced-ci-reporting.md

The new logic ensures builds are skipped when:
1. Files are covered by paths-ignore patterns
2. Only non-essential directories are modified
3. [skip-build] tag is present in commit messages

[skip-build]"

echo "$COMMIT_MSG"
echo ""

# Confirmar commit
read -p "🤔 Confirmar commit? (y/N): " confirm
if [[ $confirm =~ ^[Yy]$ ]]; then
    git commit -m "$COMMIT_MSG"
    echo "✅ Commit realizado com sucesso!"
    echo ""
    echo "📤 Próximos passos:"
    echo "1. git push origin $(git branch --show-current)"
    echo "2. Criar PR com essas correções"
    echo "3. Aguardar merge para resolver PR #3093"
else
    echo "❌ Commit cancelado."
    git reset HEAD
fi 