#!/usr/bin/env bash
# pre-push-ci-check.sh
# PreToolUse hook for git commit/push — runs local CI checks matching GitHub Actions.
# Any failure blocks the push with a clear error message.

set -euo pipefail

# Read hook input from stdin (JSON)
input=$(cat)

# Extract command field using node (jq may not be available)
cmd=$(node -e "const d=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(d.tool_input?.command||'')" <<< "$input")

# Only trigger on git push or git commit commands
if echo "$cmd" | grep -qE 'git\s+push'; then
  action="push"
elif echo "$cmd" | grep -qE 'git\s+commit'; then
  action="commit"
else
  echo '{"continue": true}'
  exit 0
fi

echo "[pre-push-ci] 检测到 git ${action}，开始本地 CI 检查..." >&2

# Determine which subprojects changed
changed=$(git diff --name-only HEAD~1 2>/dev/null || git diff --name-only --cached 2>/dev/null || true)
has_backend=0
has_frontend=0

for f in $changed; do
  case "$f" in
    backend/*) has_backend=1 ;;
    frontend/*) has_frontend=1 ;;
  esac
done

# If no changes detected, check both
if [ "$has_backend" -eq 0 ] && [ "$has_frontend" -eq 0 ]; then
  has_backend=1
  has_frontend=1
fi

errors=()

run_check() {
  local label="$1"
  shift
  echo "[pre-push-ci] $label ..." >&2
  if "$@" 2>&1; then
    echo "[pre-push-ci] $label ✅" >&2
  else
    echo "[pre-push-ci] $label ❌" >&2
    errors+=("$label")
  fi
}

# --- Backend checks ---
if [ "$has_backend" -eq 1 ]; then
  echo "[pre-push-ci] === Backend 检查 ===" >&2
  run_check "backend: ruff check"      bash -c 'cd backend && uv run ruff check .'
  run_check "backend: ruff format"     bash -c 'cd backend && uv run ruff format --check .'
  run_check "backend: mypy"            bash -c 'cd backend && uv run mypy app'
  run_check "backend: pytest"          bash -c 'cd backend && DATABASE_URL=postgresql+asyncpg://platform:platform@localhost:5432/platform_test REDIS_URL=redis://localhost:6379/15 SECRET_KEY=ci-secret-must-be-at-least-16-chars ENVIRONMENT=test uv run pytest -q --cov=app --cov-fail-under=60'
fi

# --- Frontend checks ---
if [ "$has_frontend" -eq 1 ]; then
  echo "[pre-push-ci] === Frontend 检查 ===" >&2
  run_check "frontend: lint"           bash -c 'cd frontend && pnpm lint'
  run_check "frontend: typecheck"      bash -c 'cd frontend && pnpm typecheck'
  run_check "frontend: test"           bash -c 'cd frontend && pnpm test'
  run_check "frontend: build"          bash -c 'cd frontend && NEXT_PUBLIC_API_BASE_URL=http://localhost:8000 pnpm build'
fi

if [ ${#errors[@]} -gt 0 ]; then
  err_list=$(printf '❌ %s\n' "${errors[@]}")
  msg="本地 CI 检查未通过，已阻止 git ${action}：\n${err_list}请修复后再操作。"
  # Output JSON with stopReason
  node -e "const m=process.argv[1];process.stdout.write(JSON.stringify({continue:false,stopReason:m}))" "$msg"
  exit 0
fi

echo "[pre-push-ci] 全部通过 ✅ 允许 ${action}" >&2
echo '{"continue": true}'
