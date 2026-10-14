"""add deploy_record:read permission + role seeding

Revision ID: 20261014110000
Revises: 20261012123000
Create Date: 2026-10-14 11:00:00.000000

Change 2026-10-14-deploy-release-notes task-01 / FR-06 / D-002@v1：
新增 ``deploy_record:read`` 权限点（``Permission.DEPLOY_RECORD_READ`` 枚举成员）
对应的存量角色播种——给 ``workspace_owner`` 角色补授该权限，为 task-02 只读
端点 ``require_permission(DEPLOY_RECORD_READ)`` 门控与 task-05 前端菜单可见性
提供地基（R-06 同款：防权限播种遗漏致 403/菜单不可见）。

**授予存量角色必须 SELECT**：写法逐条照 ``20260917104400_add_knowledge_write_
permission`` 先例——按 ``roles.key`` SELECT 实际 id 再插 ``role_permissions``
（typed sa.table 桩，SQLite/PG 行为一致）；数据依赖型 SELECT 意味着
``alembic upgrade --sql`` 离线生成不可用，PG 上 online upgrade 为部署期动作。

**platform_admin 免迁移行**：启动期 ``seed_platform_admin_role`` 绑全部
Permission 枚举成员（先例注释同款双重背书），无需迁移补授。

**幂等**：先 SELECT 判存再 INSERT（避开 PG/SQLite 方言差异，不用
ON CONFLICT），重跑不重复插；``role_permissions`` 主键 (role_id,
permission) 本身也是重复行兜底。

**零回归**：只增授权不删改——workspace_owner 其它权限集合、roles 本体、
其它角色全部不动（brownfield）。

**权限字符串字面量复写**：不 import app.*（迁移须可在无应用代码时生成
SQL，见 ``202605280900`` 注释）；与
``app/modules/auth/permissions.py::DEPLOY_RECORD_READ`` 的一致性由
``tests/modules/auth/test_permissions.py`` 断言对齐。

**不调 Redis**：对齐 ``202607251600`` 范式说明——``perm:{user_id}:*``
缓存按用户懒填，迁移是同步部署期动作，Redis 未就绪时调反致部署卡死。

down_revision 接 ``20261012123000``（alembic heads 实测当前单 head），
单 head 接续避免多 head 分叉（migration-chain-fragmentation-pattern）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261014110000"
down_revision: str | None = "20261012123000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 权限字符串（与 Permission.DEPLOY_RECORD_READ 一一对应）。迁移内硬编码，
# 不 import app.* —— 见模块 docstring 说明。
DEPLOY_RECORD_READ_PERMISSION: str = "deploy_record:read"

# 被授予本权限的存量系统角色（roles.key）：工作区所有者。
# （platform_admin 走启动期 seed_platform_admin_role 绑全部枚举，不插迁移行。）
TARGET_ROLE_KEYS: tuple[str, ...] = ("workspace_owner",)


def upgrade() -> None:
    """按 roles.key 给存量 workspace_owner 幂等补授 deploy_record:read。

    全程用类型化 sa.table 桩（同 202607251600 / 20260917104400 范式）：
    ``sa.select`` 走列的结果处理器，SQLite 上 ``sa.Uuid`` 列 SELECT 回填
    ``uuid.UUID``（裸 ``sa.text`` SELECT 无类型信息，SQLite 会回 str 使
    bulk_insert 绑定崩溃；PG 的 asyncpg 则天然回 UUID）——typed 桩两方言
    行为一致。
    """
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid),
        sa.column("key", sa.String),
    )
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    for key in TARGET_ROLE_KEYS:
        role_id_row = bind.execute(
            sa.select(roles_table.c.id).where(roles_table.c.key == key).limit(1)
        ).fetchone()
        if role_id_row is None:
            # 角色尚未种子（迁移顺序异常）——启动期 seed 兜底（workspace_owner
            # 走建库种子），跳过避免外键违约（同 202607041000 范式）。
            continue
        role_id = role_id_row[0]

        existing = {
            row[0]
            for row in bind.execute(
                sa.select(role_perms_table.c.permission).where(
                    role_perms_table.c.role_id == role_id
                )
            )
        }
        if DEPLOY_RECORD_READ_PERMISSION not in existing:
            op.bulk_insert(
                role_perms_table,
                [{"role_id": role_id, "permission": DEPLOY_RECORD_READ_PERMISSION}],
            )


def downgrade() -> None:
    """显式 DELETE workspace_owner 上的 deploy_record:read 授权行。

    不依赖 role_permissions.role_id → roles.id 的 ON DELETE CASCADE
    （SQLite 测试建表 / 部分场景可能不带 FK），roles 本体与其它权限不动。
    用类型化 sa.table 桩 + IN 子查询，DELETE 跨 online/offline 可移植
    （同 20260917104400 downgrade 范式）。
    """
    roles_table = sa.table(
        "roles",
        sa.column("id", sa.Uuid),
        sa.column("key", sa.String),
    )
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
        sa.column("permission", sa.String),
    )
    op.execute(
        role_perms_table.delete().where(
            role_perms_table.c.role_id.in_(
                sa.select(roles_table.c.id).where(roles_table.c.key.in_(list(TARGET_ROLE_KEYS)))
            )
            & (role_perms_table.c.permission == DEPLOY_RECORD_READ_PERMISSION)
        )
    )
