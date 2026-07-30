"""seed ppm:weekly-plan:view permission for platform_admin

Revision ID: 202607301000
Revises: 202607291100
Create Date: 2026-07-30 10:00:00.000000

给已部署环境的 platform_admin 角色补种新增菜单权限
``ppm:weekly-plan:view``（quick ql-20260730-005-1891）。

背景：``202607041000_seed_ppm_permissions`` 是 platform_admin 的 PPM 权限
单一真源，但其 upgrade 已在 PPM 上线时执行过，alembic 不会对已应用的
revision 重跑——所以本次为 ``ppm-weekly-plan`` 菜单新增的独立权限
（原 permissions 为空、对所有登录用户可见，现改为需独立权限）只能靠本
增量迁移幂等补种，否则连平台管理员也看不到「项目计划」菜单。

与 ``202607041000`` 双写：本迁移覆盖已部署环境，``202607041000`` 的
``PPM_PERMISSIONS`` 列表同步加入该 key 覆盖新环境从头 seed。

幂等：先 SELECT 判存再 INSERT，避开 PostgreSQL/SQLite 方言差异，可重复执行。
权限字符串硬编码，不 import app.*，与 ``202607041000`` 一致（见其模块 docstring）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "202607301000"
down_revision: str | None = "202607291100"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 新增的 weekly-plan 菜单权限（与 Permission.PPM_WEEKLY_PLAN_VIEW 一一对应）。
WEEKLY_PLAN_PERMISSION: str = "ppm:weekly-plan:view"


def upgrade() -> None:
    """给 platform_admin 幂等补种 ppm:weekly-plan:view（如尚未绑定）。"""
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.dialects.postgresql.UUID(as_uuid=True)),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    role_id_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE key = 'platform_admin' LIMIT 1")
    ).fetchone()
    if role_id_row is None:
        # 角色尚未种子（迁移顺序异常）—— 启动期 seed_platform_admin_role 兜底，跳过。
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
    if WEEKLY_PLAN_PERMISSION not in existing:
        op.bulk_insert(
            role_perms_table,
            [{"role_id": role_id, "permission": WEEKLY_PLAN_PERMISSION}],
        )


def downgrade() -> None:
    """对称删除 platform_admin 的 ppm:weekly-plan:view 绑定。

    精确按 permission 值删除（不像 202607041000 那样按 'ppm:%' 前缀清全量，
    增量迁移只回滚自己引入的那一条，避免误删其它 ppm 权限）。
    """
    bind = op.get_bind()
    role_id_row = bind.execute(
        sa.text("SELECT id FROM roles WHERE key = 'platform_admin' LIMIT 1")
    ).fetchone()
    if role_id_row is None:
        return
    bind.execute(
        sa.text(
            "DELETE FROM role_permissions WHERE role_id = :rid AND permission = :perm"
        ).bindparams(rid=role_id_row[0], perm=WEEKLY_PLAN_PERMISSION)
    )
