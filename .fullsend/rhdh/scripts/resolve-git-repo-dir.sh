#!/usr/bin/env bash
# Resolve a git checkout for Fullsend pre/post scripts.
#
# Post-script: prefer REPO_DIR (sandbox extraction after the agent run).
# Pre-script: prefer TARGET_REPO_DIR / target-repo (host checkout).
resolve_git_repo_dir() {
  local dir
  # Read Fullsend-injected paths first (callers must not assign REPO_DIR="" before
  # calling — that shadows the env var this function needs in post-scripts).
  for dir in \
    "${REPO_DIR:-}" \
    "${TARGET_REPO_DIR:-}" \
    "${FULLSEND_TARGET_REPO_DIR:-}" \
    "${CODE_TARGET_REPO_DIR:-}" \
    "${CODER_TARGET_REPO_DIR:-}" \
    "${GITHUB_WORKSPACE:+${GITHUB_WORKSPACE}/target-repo}" \
    target-repo \
    .; do
    if [[ -n "${dir}" && -d "${dir}/.git" ]]; then
      printf '%s' "${dir}"
      return 0
    fi
  done
  return 1
}

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  resolve_git_repo_dir || {
    echo "::error::No git checkout found (checked REPO_DIR=${REPO_DIR:-<unset>}, TARGET_REPO_DIR=${TARGET_REPO_DIR:-<unset>}, target-repo, .)" >&2
    exit 1
  }
fi
