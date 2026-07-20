"""drop ppm operation permissions

Revision ID: 20260720_drop_ppm_op
Revises: 20260720_problem_status_3state
Create Date: 2026-07-20 14:00:00.000000

清理 ppm 操作类权限授权(change 2026-07-20-ppm-permission-simplify task-02 /
design §FR-04 / D-003@v1)。

变更为 PPM 模块引入数据范围控制，操作类鉴权下沉到服务层(角色 + 组织 +
成员绑定)判断，``role_permissions`` 层不再持有 ``ppm:*:write/delete/export``
与 ``ppm:kanban:assign`` 等操作权限。本迁移从 ``role_permissions`` 表删除
17 条对应授权：

  ppm:project:write/delete/export   (3)
  ppm:customer:write/delete/export  (3)
  ppm:plan:write/delete/export      (3)
  ppm:problem:write/delete/export   (3)
  ppm:task:write/delete/export      (3)
  ppm:work-hour:write               (1)
  ppm:kanban:assign                 (1)

种子迁移 ``202607041000_seed_ppm_permissions`` 已同步精简 ``PPM_PERMISSIONS``
清单 25→8(仅保留菜单权限)，故新环境从头 seed 不会再产生这 17 条授权；
本迁移面向已部署环境的存量数据做 ``DELETE`` 收敛。

权限字符串硬编码于本文件(沿用旧迁移离线生成 SQL 风格，不 import app.*)，
避开 PG/SQLite 方言差异(不用 ON CONFLICT)。downgrade 对称回植到
``platform_admin`` 角色，参照旧迁移 ``202607041000`` 的幂等风格。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260720_drop_ppm_op"
down_revision: str | None = "20260720_problem_status_3state"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 被清理的 17 个 ppm 操作类权限字符串。迁移内硬编码，不 import app.* ——
# 见模块 docstring 说明。
DROPPED_PPM_PERMISSIONS: list[str] = [
    # 项目
    "ppm:project:write",
    "ppm:project:delete",
    "ppm:project:export",
    # 客户
    "ppm:customer:write",
    "ppm:customer:delete",
    "ppm:customer:export",
    # 计划
    "ppm:plan:write",
    "ppm:plan:delete",
    "ppm:plan:export",
    # 问题
    "ppm:problem:write",
    "ppm:problem:delete",
    "ppm:problem:export",
    # 任务
    "ppm:task:write",
    "ppm:task:delete",
    "ppm:task:export",
    # 工时
    "ppm:work-hour:write",
    # 看板
    "ppm:kanban:assign",
]


def upgrade() -> None:
    """删除 17 条 ppm 操作类权限授权(标准 SQL，PG/SQLite 通用)。"""
    if not DROPPED_PPM_PERMISSIONS:
        return

    # DELETE ... WHERE permission IN (:p1, :p2, ...) —— 标准 SQL，两端通用。
    placeholders = ", ".join(f":p{i}" for i in range(len(DROPPED_PPM_PERMISSIONS)))
    params = {f"p{i}": perm for i, perm in enumerate(DROPPED_PPM_PERMISSIONS)}
    op.execute(
        sa.text(f"DELETE FROM role_permissions WHERE permission IN ({placeholders})").bindparams(
            **params
        )
    )


def downgrade() -> None:
    """对称回植 17 个 ppm 操作权限到 platform_admin 角色(幂等)。

    幂等实现参照 ``202607041000_seed_ppm_permissions.upgrade``：先取
    platform_admin 角色 id(系统内置，缺失则跳过避免外键违约)，再 SELECT
    已绑定的权限集合，仅 bulk_insert 缺失项。避开 PG/SQLite 方言差异
    (不用 ON CONFLICT)。
    """
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    # 取出 platform_admin 角色 id(系统内置，必然存在)。
    role_id_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE key = 'platform_admin' LIMIT 1")
    ).fetchone()
    if role_id_row is None:
        # 角色尚未种子(迁移顺序异常)—— 跳过避免外键违约。
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
        {"role_id": role_id, "permission": perm}
        for perm in DROPPED_PPM_PERMISSIONS
        if perm not in existing
    ]
    if new_rows:
        op.bulk_insert(role_perms_table, new_rows)
