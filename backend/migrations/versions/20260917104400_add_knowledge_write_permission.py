"""add knowledge:write permission + role seeding

Revision ID: 20260917104400
Revises: 20260914100000
Create Date: 2026-09-17 10:44:00.000000

Change 2026-09-17-knowledge-precipitation task-02 / FR-02 / D-005@v1：
新增 ``knowledge:write`` 权限点（``Permission.KNOWLEDGE_WRITE`` 枚举成员）
对应的存量角色播种——给 ``platform_admin`` 与 ``workspace_owner`` 两角色补授
该权限，为 task-04 写端点 ``require_permission(KNOWLEDGE_WRITE)`` 门控与
task-05 前端权限驱动写按钮提供地基（R-06：防权限播种遗漏致 403）。

**授予存量角色必须 SELECT**：与 ``202607251600``（bulk_insert 新建
business_member 角色、Python uuid 复用）不同，本迁移授予的角色是
``202605280900`` 已种子的存量行，role_id 不能运行时生成，须按
``roles.key`` SELECT 实际 id 再插 ``role_permissions``（写法同
``202607041000`` / ``202607301000`` 先例）。数据依赖型 SELECT 意味着
``alembic upgrade --sql`` 离线生成不可用（op.get_bind() 为 None）——同
先例取舍，PG 上 online upgrade 为部署期动作。

**幂等**：先 SELECT 判存再 INSERT（避开 PG/SQLite 方言差异，不用
ON CONFLICT），重跑不重复插；``role_permissions`` 主键 (role_id,
permission) 本身也是重复行兜底。

**零回归**：只增授权不删改——两角色的其它权限集合、roles 本体、其它
角色全部不动（brownfield）。

**权限字符串字面量复写**：不 import app.*（迁移须可在无应用代码时生成
SQL，见 ``202605280900`` 注释）；与
``app/modules/auth/permissions.py::KNOWLEDGE_WRITE`` 的一致性由
``tests/modules/auth/test_permissions.py`` 断言对齐。

**不调 Redis**：对齐 ``202607251600`` 范式说明——``perm:{user_id}:*``
缓存按用户懒填，迁移是同步部署期动作，Redis 未就绪时调反致部署卡死。

down_revision 接 ``20260914100000``（alembic heads 实测当前单 head），
单 head 接续避免多 head 分叉（migration-chain-fragmentation-pattern）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260917104400"
down_revision: str | None = "20260914100000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 权限字符串（与 Permission.KNOWLEDGE_WRITE 一一对应）。迁移内硬编码，
# 不 import app.* —— 见模块 docstring 说明。
KNOWLEDGE_WRITE_PERMISSION: str = "knowledge:write"

# 被授予本权限的存量系统角色（roles.key）：平台管理员 + 工作区所有者。
TARGET_ROLE_KEYS: tuple[str, ...] = ("platform_admin", "workspace_owner")


def upgrade() -> None:
    """按 roles.key 给存量 platform_admin / workspace_owner 幂等补授 knowledge:write。

    全程用类型化 sa.table 桩（同 202607251600 范式）：``sa.select`` 走列的
    结果处理器，SQLite 上 ``sa.Uuid`` 列 SELECT 回填 ``uuid.UUID``（裸
    ``sa.text`` SELECT 无类型信息，SQLite 会回 str 使 bulk_insert 绑定崩溃；
    PG 的 asyncpg 则天然回 UUID）——typed 桩两方言行为一致。
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
            # 角色尚未种子（迁移顺序异常）——启动期 seed 兜底（platform_admin 走
            # seed_platform_admin_role 绑全部枚举；workspace_owner 走建库种子），跳过
            # 避免外键违约（同 202607041000 范式）。
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
        if KNOWLEDGE_WRITE_PERMISSION not in existing:
            op.bulk_insert(
                role_perms_table,
                [{"role_id": role_id, "permission": KNOWLEDGE_WRITE_PERMISSION}],
            )


def downgrade() -> None:
    """显式 DELETE 两角色上的 knowledge:write 授权行。

    不依赖 role_permissions.role_id → roles.id 的 ON DELETE CASCADE
    （SQLite 测试建表 / 部分场景可能不带 FK），roles 本体与其它权限不动。
    用类型化 sa.table 桩 + IN 子查询，DELETE 跨 online/offline 可移植
    （同 202607251600 downgrade 范式）。
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
            & (role_perms_table.c.permission == KNOWLEDGE_WRITE_PERMISSION)
        )
    )
