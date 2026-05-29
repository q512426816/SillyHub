"""Static permission catalogue.

Mirrors ``references/16-rbac.md`` §2. Keep this list in sync with the seed
data in migration ``202605280900_create_auth_and_rbac.py``: anything missing
here is unreachable from the API layer regardless of what the DB grants.
"""

from __future__ import annotations

from enum import StrEnum


class Permission(StrEnum):
    # ── Platform ────────────────────────────────────────────
    PLATFORM_ADMIN = "platform:admin"
    PLATFORM_BILLING = "platform:billing"
    PLATFORM_AUDIT_READ = "platform:audit:read"

    # ── Workspace ───────────────────────────────────────────
    WORKSPACE_READ = "workspace:read"
    WORKSPACE_WRITE = "workspace:write"
    WORKSPACE_ADMIN = "workspace:admin"
    WORKSPACE_MEMBER_MANAGE = "workspace:member:manage"

    # ── Change ──────────────────────────────────────────────
    CHANGE_CREATE = "change:create"
    CHANGE_READ = "change:read"
    CHANGE_UPDATE = "change:update"
    CHANGE_APPROVE = "change:approve"
    CHANGE_ARCHIVE = "change:archive"

    # ── Task ────────────────────────────────────────────────
    TASK_READ = "task:read"
    TASK_CREATE = "task:create"
    TASK_ASSIGN = "task:assign"
    TASK_RUN_AGENT = "task:run_agent"
    TASK_CANCEL = "task:cancel"
    TASK_APPROVE = "task:approve"

    # ── Code ────────────────────────────────────────────────
    CODE_READ = "code:read"
    CODE_WRITE = "code:write"
    CODE_REVIEW = "code:review"
    CODE_MERGE = "code:merge"

    # ── Deploy ──────────────────────────────────────────────
    DEPLOY_STAGING = "deploy:staging"
    DEPLOY_PRODUCTION = "deploy:production"
    DEPLOY_ROLLBACK = "deploy:rollback"

    # ── Tool ────────────────────────────────────────────────
    TOOL_SHELL_EXEC = "tool:shell_exec"
    TOOL_NETWORK = "tool:network"
    TOOL_DATABASE = "tool:database"
    TOOL_SECRET_READ = "tool:secret:read"
