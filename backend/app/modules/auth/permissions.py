"""Static permission catalogue.

Mirrors ``references/16-rbac.md`` §2 + ``2026-06-16-admin-org-role-center``
design §8.4. Keep this list in sync with the seed data in migration
``202605280900_create_auth_and_rbac.py`` and the admin org/role bootstrap
in ``auth.seed``: anything missing here is unreachable from the API layer
regardless of what the DB grants.
"""

from __future__ import annotations

from enum import StrEnum


class PermissionGroup(StrEnum):
    """Logical grouping for UI rendering (admin center sidebar / picker).

    Mirrors design §5.3. The ``group`` property on :class:`Permission`
    resolves each entry into one of these buckets so the frontend can
    fold permissions by category without a separate mapping table.
    """

    PLATFORM = "platform"
    ADMIN = "admin"
    WORKSPACE = "workspace"
    AGENT = "agent"
    CHANGE = "change"
    AUDIT = "audit"


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

    # ── Workspace 子菜单独立查看权限 ────────────────────────
    # 用于前端 menu 显隐粒度化：每个 overview/management 子菜单有独立 read 权限，
    # 避免所有菜单共用 workspace:read 致 picker 重复展示。
    # 后端 router 各自 require 对应权限。
    COMPONENT_READ = "component:read"
    TOPOLOGY_READ = "topology:read"
    SCAN_DOCS_READ = "scan-docs:read"
    RUNTIME_READ = "runtime:read"
    KNOWLEDGE_READ = "knowledge:read"
    INCIDENT_READ = "incident:read"

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

    # ── Admin (user / organization / role management) ───────
    # Mirrors design §8.4 — added in change 2026-06-16-admin-org-role-center.
    USER_READ = "user:read"
    USER_WRITE = "user:write"
    USER_LOGIN_MANAGE = "user:login:manage"
    ORGANIZATION_READ = "organization:read"
    ORGANIZATION_WRITE = "organization:write"
    ROLE_READ = "role:read"
    ROLE_WRITE = "role:write"

    @property
    def group(self) -> PermissionGroup:
        """Resolve the logical group for UI rendering.

        Mirrors design §5.3. ``platform:audit:read`` is the lone AUDIT
        special case; everything else keys off the ``<prefix>:`` portion
        of the value.
        """
        if self is Permission.PLATFORM_AUDIT_READ:
            return PermissionGroup.AUDIT
        prefix = self.value.split(":", 1)[0]
        if prefix in ("user", "organization", "role"):
            return PermissionGroup.ADMIN
        if prefix == "workspace":
            return PermissionGroup.WORKSPACE
        if prefix in (
            "component",
            "topology",
            "scan-docs",
            "runtime",
            "knowledge",
            "incident",
        ):
            # workspace 子菜单独立 read 权限归类到 WORKSPACE 组
            return PermissionGroup.WORKSPACE
        if prefix == "change":
            return PermissionGroup.CHANGE
        if prefix in ("task", "code", "tool", "deploy"):
            return PermissionGroup.AGENT
        return PermissionGroup.PLATFORM
