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
    # PPM (项目与问题管理) 平台级业务域 — change 2026-06-20-ppm-module-migration
    # task-02 / design §6/§7。前端菜单按 PPM 折叠展示。
    PPM = "ppm"


class Permission(StrEnum):
    # ── Platform ────────────────────────────────────────────
    PLATFORM_ADMIN = "platform:admin"
    PLATFORM_BILLING = "platform:billing"
    PLATFORM_AUDIT_READ = "platform:audit:read"

    # ── Platform 子菜单独立管理权限 ──────────────────────────
    # 用于前端 menu 显隐粒度化：每个 management/system 子菜单有独立 admin 权限，
    # 避免 settings / api-keys / runtimes / git-identities 多个菜单共用 platform:admin
    # 致 picker 重复或缺失。后端 router 各自 require 对应权限
    # （替换原 require_platform_admin / _require_platform_admin / get_current_user）。
    SETTINGS_ADMIN = "settings:admin"
    API_KEY_ADMIN = "api_key:admin"
    RUNTIME_ADMIN = "runtime:admin"
    GIT_IDENTITY_ADMIN = "git_identity:admin"

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

    # ── PPM 项目与问题管理(平台级业务域) ─────────────────────
    # change 2026-07-20-ppm-permission-simplify task-04 精简：原 22 Controller 的
    # write/delete/export/assign 动作权限为摆设(后端 router 全部走 get_current_principal
    # 数据范围鉴权，不引用这些枚举)，仅保留 8 个菜单/读类权限供前端菜单折叠展示。
    # 项目(pm:project-maintenance:read + pm:project-member:read 复用 project:read)
    PPM_PROJECT_READ = "ppm:project:read"
    # 客户(pm:customer-maintenance:read)
    PPM_CUSTOMER_READ = "ppm:customer:read"
    # 计划(ps:project-plan:read + plan:plan-node:read + plan:node:read + ppm:plan-node-module:read)
    PPM_PLAN_READ = "ppm:plan:read"
    # 问题(problem:list:read + problem:change:read + problem:*-process-task/log:read)
    PPM_PROBLEM_READ = "ppm:problem:read"
    # 任务(task:plan:read + ppm:personal-task-plan:read + ppm:task-execute:read)
    PPM_TASK_READ = "ppm:task:read"
    # 工时(ppm:work-hour:read)
    PPM_WORKHOUR_READ = "ppm:work-hour:read"
    # 工时统计(ppm:work-hour:stat 对应源 :stat)
    PPM_WORKHOUR_STAT = "ppm:work-hour:stat"
    # 看板(ppm:task:kanban:view)
    PPM_KANBAN_VIEW = "ppm:kanban:view"

    @property
    def group(self) -> PermissionGroup:
        """Resolve the logical group for UI rendering.

        Mirrors design §5.3. ``platform:audit:read`` is the lone AUDIT
        special case; everything else keys off the ``<prefix>:`` portion
        of the value.
        """
        if self is Permission.PLATFORM_AUDIT_READ:
            return PermissionGroup.AUDIT
        # runtime 同时存在 workspace:read（子菜单）与 platform:admin（菜单管理），
        # 无法仅靠前缀区分，按完整 value 单独判定。
        if self is Permission.RUNTIME_READ:
            return PermissionGroup.WORKSPACE
        if self is Permission.RUNTIME_ADMIN:
            return PermissionGroup.PLATFORM
        prefix = self.value.split(":", 1)[0]
        if prefix in ("user", "organization", "role"):
            return PermissionGroup.ADMIN
        if prefix == "workspace":
            return PermissionGroup.WORKSPACE
        if prefix in (
            "component",
            "topology",
            "scan-docs",
            "knowledge",
            "incident",
        ):
            # workspace 子菜单独立 read 权限归类到 WORKSPACE 组
            # runtime:read 已在上面单独判定，runtime:admin 走默认 PLATFORM
            return PermissionGroup.WORKSPACE
        if prefix == "change":
            return PermissionGroup.CHANGE
        if prefix in ("task", "code", "tool", "deploy"):
            return PermissionGroup.AGENT
        # PPM_* 全部以 ppm: 前缀，归入 PPM 业务域组
        if prefix == "ppm":
            return PermissionGroup.PPM
        return PermissionGroup.PLATFORM
