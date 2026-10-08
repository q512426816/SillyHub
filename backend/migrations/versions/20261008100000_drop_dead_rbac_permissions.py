"""drop dead rbac permissions

Revision ID: 20261008100000
Revises: 20261006200000
Create Date: 2026-10-08 10:00:00.000000

清理零端点消费的 RBAC 死权限授权行（change 2026-10-08-rbac-dead-permissions-cleanup）。

背景：全站菜单权限对账发现 14 个 Permission 枚举成员在后端（含
sillyhub-daemon）零非测试引用——code:*×4 / tool:*×4 为 2026-05-25 bootstrap
参考设计的代码评审/工具门控残留（平台演进为 git 网关 + 会话 canUseTool
审批后从未接线）；task:cancel / task:approve / platform:audit:read /
platform:billing / component:read / change:update 为意图未接线或功能未建。
枚举已同步删除（permissions.py，72→58）。

本迁移从 ``role_permissions`` 删除 16 个死字符串的全量行：上述 14 键 +
``component:write`` / ``component:admin``（种子 202605280900 播种过、但从未
进入 Permission 枚举的残留）。种子迁移 SYSTEM_ROLES 已同步精简，新环境从头
seed 不再产生死行；本迁移面向已部署环境存量收敛（仿 20260720_drop_ppm_op
先例）。

权限字符串硬编码于本文件（沿用旧迁移离线生成 SQL 风格，不 import app.*），
避开 PG/SQLite 方言差异（不用 ON CONFLICT）。downgrade 对称回植全部 16 个
字符串到 ``platform_admin`` 角色（幂等，参照 202607041000_seed_ppm_permissions
的 SELECT-已绑定-再-bulk_insert 风格；自定义角色的历史授予不可恢复，回植
以系统种子形态为基准）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261008100000"
down_revision: str | None = "20261006200000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 被清理的 16 个死权限字符串（14 个已删枚举成员 + 2 个从未入枚举的种子残留）。
# 迁移内硬编码，不 import app.* —— 见模块 docstring 说明。
DROPPED_DEAD_PERMISSIONS: list[str] = [
    # Code（bootstrap 设计残留，零端点消费）
    "code:read",
    "code:write",
    "code:review",
    "code:merge",
    # Tool（同上——工具门控现行机制为会话 canUseTool 审批）
    "tool:shell_exec",
    "tool:network",
    "tool:database",
    "tool:secret:read",
    # Task 死动作（审批走 change:approve；取消无端点）
    "task:cancel",
    "task:approve",
    # Platform 死键（平台审计端点实际鉴权 change:read；计费未建）
    "platform:audit:read",
    "platform:billing",
    # 组件/变更死键（组件列表端点鉴权 workspace:read；变更编辑走 create+owner）
    "component:read",
    "change:update",
    # 从未进入 Permission 枚举的种子残留（202605280900 workspace_owner 播种）
    "component:write",
    "component:admin",
]


def upgrade() -> None:
    """删除 16 个死权限字符串的全部授权行（标准 SQL，PG/SQLite 通用）。"""
    placeholders = ", ".join(f":p{i}" for i in range(len(DROPPED_DEAD_PERMISSIONS)))
    params = {f"p{i}": perm for i, perm in enumerate(DROPPED_DEAD_PERMISSIONS)}
    op.execute(
        sa.text(f"DELETE FROM role_permissions WHERE permission IN ({placeholders})").bindparams(
            **params
        )
    )


def downgrade() -> None:
    """对称回植 16 个死权限字符串到 platform_admin 角色（幂等）。

    幂等实现参照 ``202607041000_seed_ppm_permissions.upgrade``：先取
    platform_admin 角色 id（系统内置，缺失则跳过避免外键违约），再 SELECT
    已绑定的权限集合，仅 bulk_insert 缺失项。
    """
    # 通用 sa.Uuid(as_uuid=False)（非 postgresql.UUID）：SQLite 回放测试里
    # SELECT 返回 hex 字符串、PG 专用类型/binds 需 UUID 对象，两端不兼容；
    # as_uuid=False 双向按字符串处理，SQLite 直存、PG 驱动自动转 uuid 列。
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid(as_uuid=False)),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    role_id_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE key = 'platform_admin' LIMIT 1")
    ).fetchone()
    if role_id_row is None:
        return
    role_id = role_id_row[0]

    existing = {
        row[0]
        for row in bind.execute(
            sa.text("SELECT permission FROM role_permissions WHERE role_id = :rid").bindparams(
                rid=role_id
            )
        )
    }

    new_rows = [
        {"role_id": role_id, "permission": perm}
        for perm in DROPPED_DEAD_PERMISSIONS
        if perm not in existing
    ]
    if new_rows:
        op.bulk_insert(role_perms_table, new_rows)
