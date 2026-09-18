"""create menu_overrides table + seed 4 menu-read permissions

Revision ID: 20260918150000
Revises: 20260917160000
Create Date: 2026-09-18 15:00:00.000000

Change ``2026-09-18-web-menu-management`` task-03 / FR-01 / D-001@v1：
建 ``menu_overrides`` 菜单显示覆盖表（列与 task-02 的
``app/modules/admin/model.py::MenuOverride`` 一一对应），并把 4 个新菜单
读权限 key 幂等授给全部现存角色，保证上线后 skills / mcp / agent-profiles
/ sessions 四个此前常显的菜单可见性与现状一致（此后管理员可在角色管理页
按角色收回）。

**种子覆盖全部现存角色（含 disabled）**：与 ``20260917104400``（按
``roles.key`` 定点补授两角色）不同，本迁移 ``SELECT`` 全部 ``roles.id``、
不筛 ``is_active``——保现状语义对 disabled 角色同样成立（无害）；无任何
角色的存量用户为已接受的窄例外（design R-07）。**不授 ``menu:admin``**：
该 key 门控菜单管理页与覆盖写端点，授予属管理员运营决策，走角色管理页
（design 总体方案 Phase 1.2）。

**授予存量角色必须 SELECT**：role_id 是 ``202605280900`` 起的存量行，
不能运行时生成，须 SELECT 实际 id 再插 ``role_permissions``（写法同
``20260917104400`` / ``202607041000`` 先例）。数据依赖型 SELECT 意味着
``alembic upgrade --sql`` 离线生成不可用（``op.get_bind()`` 为 None）——
同先例取舍，online upgrade 为部署期动作。

**幂等**：先 SELECT 判存再 bulk_insert（避开 PG/SQLite 方言差异，不用
ON CONFLICT），重跑不重复插；``role_permissions`` 复合主键
``(role_id, permission)``（``202605280900`` 建表定义确认）本身也是重复
行兜底。

**零回归**：只增授权不删改——其它权限行、roles 本体全部不动
（brownfield）。

**权限字符串字面量复写**：不 import app.*（迁移须可在无应用代码时生成
SQL，见 ``202605280900`` 注释）；与
``app/modules/auth/permissions.py`` 的 ``SKILL_READ`` / ``MCP_READ`` /
``AGENT_PROFILE_READ`` / ``AGENT_SESSION_READ`` 枚举成员值的一致性由
``tests/modules/admin/test_menu_overrides.py`` 断言对齐（task-06）。

**不调 Redis**：对齐 ``20260917104400`` 范式说明——``perm:{user_id}:*``
缓存按用户懒填、TTL 300 秒自愈，迁移是同步部署期动作，Redis 未就绪时调
``invalidate_all_permissions()`` 反致部署卡死（design R-02）。

down_revision 接 ``20260917160000``（写码时 ``alembic heads`` 实测唯一
head），单 head 接续避免多 head 分叉
（migration-chain-fragmentation-pattern）。
"""

from __future__ import annotations

from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260918150000"
down_revision: str | None = "20260917160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# 4 个新菜单读权限（与 Permission 枚举 4 个新成员一一对应）。迁移内硬
# 编码，不 import app.* —— 见模块 docstring 说明。刻意不含 menu:admin
# （见 docstring「种子覆盖全部现存角色」段）。
MENU_READ_PERMISSIONS: tuple[str, ...] = (
    "skill:read",
    "mcp:read",
    "agent_profile:read",
    "agent_session:read",
)


def upgrade() -> None:
    """建 menu_overrides 表 + 4 个新权限授全部现存角色（幂等）。

    全程用类型化 sa.table 桩（同 ``20260917104400`` 范式）：``sa.select``
    走列的结果处理器，SQLite 上 ``sa.Uuid`` 列 SELECT 回填 ``uuid.UUID``
    （裸 ``sa.text`` SELECT 无类型信息，SQLite 会回 str 使 bulk_insert 绑定
    崩溃；PG 的 asyncpg 则天然回 UUID）——typed 桩两方言行为一致。
    """
    op.create_table(
        "menu_overrides",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column("menu_key", sa.String(length=64), nullable=False, unique=True),
        sa.Column("label_override", sa.String(length=30), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column(
            "hidden",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )

    roles_table = sa.table("roles", sa.column("id", sa.Uuid))
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
        sa.column("permission", sa.String),
    )
    bind = op.get_bind()

    # 全部现存角色（不筛 is_active，含 disabled——见模块 docstring）。
    role_ids = [row[0] for row in bind.execute(sa.select(roles_table.c.id))]

    # 仅查 4 个目标 key 的既有行做判存（比全表拉取更窄，且足够判定重复）。
    existing_pairs = {
        (row[0], row[1])
        for row in bind.execute(
            sa.select(role_perms_table.c.role_id, role_perms_table.c.permission).where(
                role_perms_table.c.permission.in_(list(MENU_READ_PERMISSIONS))
            )
        )
    }
    rows = [
        {"role_id": role_id, "permission": permission}
        for permission in MENU_READ_PERMISSIONS
        for role_id in role_ids
        if (role_id, permission) not in existing_pairs
    ]
    if rows:
        op.bulk_insert(role_perms_table, rows)


def downgrade() -> None:
    """删 4 个 key 的全部 role_permissions 授权行 + drop menu_overrides。

    先显式 DELETE（不依赖 role_permissions.role_id → roles.id 的 ON DELETE
    CASCADE——SQLite 测试建表 / 部分场景可能不带 FK），roles 本体与其它
    权限行全部不动；再 drop menu_overrides（覆盖数据随表消亡，导航回代码
    默认，与 upgrade 前现状一致）。用类型化 sa.table 桩 + IN 删除，跨
    online/offline 可移植（同 ``20260917104400`` downgrade 范式）。
    """
    role_perms_table = sa.table(
        "role_permissions",
        sa.column("role_id", sa.Uuid),
        sa.column("permission", sa.String),
    )
    op.execute(
        role_perms_table.delete().where(
            role_perms_table.c.permission.in_(list(MENU_READ_PERMISSIONS))
        )
    )
    op.drop_table("menu_overrides")
