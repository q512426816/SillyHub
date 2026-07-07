#!/bin/sh
set -eu

mkdir -p "${HOME:-/app}/.claude"
mkdir -p /data/spec-workspaces
# 2026-07-07-daemon-skill-execution task-07：把镜像内 /app/sillyspec-skills/ 软链到
# /app/.claude/skills（claude-data volume 挂在 /app/.claude 遮盖镜像 COPY 内容，
# 故镜像把 skills 放非 volume 路径 /app/sillyspec-skills，启动时软链进 volume）。
# 幂等：每次启动确保软链存在（容器重启不影响，volume 里软链可能被清）。
if [ -d /app/sillyspec-skills ] && [ ! -e "${HOME:-/app}/.claude/skills" ]; then
  ln -s /app/sillyspec-skills "${HOME:-/app}/.claude/skills"
fi
chown -R app:app /data/spec-workspaces 2>/dev/null || true

python - <<'PY'
import json
import os
from pathlib import Path


def enabled(name: str, default: bool = True) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


home = Path(os.environ.get("HOME", "/app"))
settings_path = home / ".claude" / "settings.json"

env_keys = [
    "ANTHROPIC_BASE_URL",
    "API_TIMEOUT_MS",
    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
    "ANTHROPIC_AUTH_TOKEN",
]

settings = {
    "env": {key: os.environ[key] for key in env_keys if os.environ.get(key)},
    "model": os.environ.get("CLAUDE_CODE_MODEL", "opus"),
    "enabledPlugins": {
        "frontend-design@claude-plugins-official": enabled("CLAUDE_PLUGIN_FRONTEND_DESIGN_ENABLED"),
        "playwright@claude-plugins-official": enabled("CLAUDE_PLUGIN_PLAYWRIGHT_ENABLED"),
    },
    "extraKnownMarketplaces": {
        "claude-plugins-official": {
            "source": {
                "source": "github",
                "repo": "anthropics/claude-plugins-official",
            }
        }
    },
    "skipDangerousModePermissionPrompt": enabled("CLAUDE_SKIP_DANGEROUS_MODE_PERMISSION_PROMPT"),
    "hooks": {
        "PreToolUse": [
            {
                "matcher": "Write|Edit|MultiEdit",
                "hooks": [
                    {
                        "type": "command",
                        "command": "python /app/hooks/scan_write_guard.py",
                        "timeout": 5,
                    }
                ],
            }
        ],
    },
}

settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
settings_path.chmod(0o600)
PY

is_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if is_enabled "${CLAUDE_SYNC_OFFICIAL_PLUGINS_ON_START:-true}"; then
  claude plugin marketplace add anthropics/claude-plugins-official --scope user >/dev/null 2>&1 \
    || claude plugin marketplace update claude-plugins-official >/dev/null 2>&1 \
    || echo "warning: unable to sync claude-plugins-official marketplace" >&2

  if is_enabled "${CLAUDE_PLUGIN_FRONTEND_DESIGN_ENABLED:-true}"; then
    claude plugin install frontend-design@claude-plugins-official --scope user >/dev/null 2>&1 \
      || echo "warning: unable to install frontend-design@claude-plugins-official" >&2
  fi

  if is_enabled "${CLAUDE_PLUGIN_PLAYWRIGHT_ENABLED:-true}"; then
    claude plugin install playwright@claude-plugins-official --scope user >/dev/null 2>&1 \
      || echo "warning: unable to install playwright@claude-plugins-official" >&2
  fi
fi

# Allow git operations on bind-mounted host directories
git config --global --add safe.directory '*' 2>/dev/null || true

exec "$@"
