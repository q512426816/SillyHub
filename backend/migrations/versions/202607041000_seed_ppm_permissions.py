"""seed ppm permissions for platform_admin

Revision ID: 202607041000
Revises: 202607040900
Create Date: 2026-07-04 10:00:00.000000

为 platform_admin 角色补种全部 PPM_* 权限(change
2026-06-20-ppm-module-migration task-02 / design §6/§7)。

权限字符串与 ``app/modules/auth/permissions.py`` 的 ``Permission`` 枚举
保持一致(迁移故意不复用 app.*，保证可离线生成 SQL，见
``202605280900_create_auth_and_rbac.py`` 注释)。源 @PreAuthorize 归并:

  ppm:project:*      ← pm:project-maintenance:* + pm:project-member:*
  ppm:customer:*     ← pm:customer-maintenance:*
  ppm:plan:*         ← ps:project-plan:* + plan:plan-node:* + plan:node:*
                       + ppm:plan-node-module:*
  ppm:problem:*      ← problem:list:* + problem:change:*
                       + problem:*-process-task/log:*
  ppm:task:*         ← task:plan:* + ppm:personal-task-plan:*
                       + ppm:task-execute:*
  ppm:work-hour:*    ← ppm:work-hour:* (stat 对应源 :stat)
  ppm:kanban:*       ← ppm:task:kanban:view / assign

downgrade 对称删除所有以 ``ppm:`` 开头的 role_permissions 行，不影响
platform_admin 已有的其它权限绑定。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607041000"
down_revision: str | None = "202607040900"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# PPM_* 权限字符串(与 Permission 枚举 PPM_* 成员一一对应)。迁移内硬编码，
# 不 import app.* —— 见模块 docstring 说明。
PPM_PERMISSIONS: list[str] = [
    # 项目
    "ppm:project:read",
    "ppm:project:write",
    "ppm:project:delete",
    "ppm:project:export",
    # 客户
    "ppm:customer:read",
    "ppm:customer:write",
    "ppm:customer:delete",
    "ppm:customer:export",
    # 计划
    "ppm:plan:read",
    "ppm:plan:write",
    "ppm:plan:delete",
    "ppm:plan:export",
    # 问题
    "ppm:problem:read",
    "ppm:problem:write",
    "ppm:problem:delete",
    # 任务
    "ppm:task:read",
    "ppm:task:write",
    "ppm:task:delete",
    "ppm:task:export",
    # 工时
    "ppm:work-hour:read",
    "ppm:work-hour:write",
    "ppm:work-hour:stat",
    # 看板
    "ppm:kanban:view",
    "ppm:kanban:assign",
]


def upgrade() -> None:
    """给 platform_admin 角色插入全部 PPM_* 权限(幂等)。

    幂等实现:对每个权限先 SELECT 判定是否已存在，不存在才 INSERT。
    避开 PostgreSQL/SQLite 方言差异(不用 ON CONFLICT)，保证迁移可
    在两种后端重复执行。
    """
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.String),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    # 取出 platform_admin 角色 id(系统内置，必然存在)。
    role_id_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE key = 'platform_admin' LIMIT 1")
    ).fetchone()
    if role_id_row is None:
        # 角色尚未种子(迁移顺序异常)—— 等启动期 seed_platform_admin_role
        # 兜底补齐，这里跳过避免外键违约。
        return
    role_id = role_id_row[0]

    # 已绑定的权限集合。
    existing = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT permission FROM role_permissions WHERE role_id = :rid").bindparams(
                rid=role_id
            )
        )
    }

    new_rows = [
        {"role_id": role_id, "permission": perm} for perm in PPM_PERMISSIONS if perm not in existing
    ]
    if new_rows:
        op.bulk_insert(role_perms_table, new_rows)


def downgrade() -> None:
    """对称删除所有以 ppm: 开头的 role_permissions 行。

    platform_admin 是唯一被 seed_ppm 授予 PPM_* 的角色，但按前缀删除
    更稳健(若后续有其它角色手动获得 ppm:* 也会被一并清理，符合本变更
    “回滚即移除 PPM 权限域”的语义)。
    """
    op.execute(sa.text("DELETE FROM role_permissions WHERE permission LIKE 'ppm:%'"))
