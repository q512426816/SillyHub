"""platform_change_progress 主键迁移到 id（change_name 去主键 + 现有行回填）

Revision ID: 20260813160000
Revises: 20260811150000
Create Date: 2026-08-13 16:00:00

Change 2026-08-13-fix-platform-progress-pk task-02 / design §5/§8/§9 / D-001@v1 / R-01：
``platform_change_progress`` 主键从 ``change_name``（全局唯一）迁移到独立 ``id`` UUID，
消除跨 workspace 重名冲突与 NULL 历史行挡道两个缺陷（design §1）。现有行回填 uuid4
保留（D-003，brownfield 不丢进度）。

执行顺序（关键，D-003/R-01）：
1. add ``id`` 列（先 nullable）——SQLite ``ALTER TABLE ADD COLUMN`` 直加，不触发重建
2. ``op.get_bind()`` 逐行 UPDATE 回填 uuid4 —— **必须在 batch recreate 之前**，
   否则 SQLite copy-and-move 重建新表时 id 为 NOT NULL 且旧行无值 → INSERT SELECT 失败
3. ``op.batch_alter_table``（copy-and-move 重建，precedent ``20260811104500``）：
   ``id`` 设 NOT NULL + drop ``change_name`` PK + ``id`` 设主键。SQLite 不支持直接
   ``op.drop_constraint`` PK（raise）/ ``op.create_primary_key``（静默跳过），必须 batch
   重建；PG 生产 batch 为 no-op wrapper 直接 ALTER（dialect 无关对齐）。
4. 复合唯一约束 ``uq_platform_change_progress_workspace_change`` 不显式触碰：
   SQLite 上它是唯一索引，batch copy 随表自动搬运（重建后仍在）；PG batch 为
   no-op wrapper 直接 ALTER 不动它。dialect 无关保持约束。

PK 约束名 dialect 不同：SQLite 合成 ``pk_<table>``，PG 由数据库自动命名
（``platform_change_progress_pkey``），故 drop 前经 inspector 反射实际名。

downgrade 抛 NotImplementedError：upgrade 允许跨 workspace 同名 ``change_name`` 共存
（本次修复的核心语义），downgrade 无法安全恢复 ``change_name`` 单主键（数据可能冲突），
结构反向不可逆（precedent ``20260713_fix_session_zombie`` 同为不可逆 downgrade）。

author: qinyi
created_at: 2026-08-13 16:00:00
"""

from __future__ import annotations

import uuid
from typing import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20260813170000"
down_revision: str | None = "20260813160000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # ── 1. add id 列（先 nullable；SQLite ALTER TABLE ADD COLUMN 直加，不触发重建） ──
    with op.batch_alter_table("platform_change_progress", schema=None) as batch_op:
        batch_op.add_column(sa.Column("id", sa.Uuid(as_uuid=True), nullable=True))

    # ── 2. op.get_bind() 逐行回填 uuid4（D-003：现有行保留不丢进度） ──
    #    必须在 batch recreate（第 3 步）之前执行——SQLite copy-and-move 重建时
    #    若 id 为 NOT NULL 且旧行无值，INSERT INTO new SELECT 会失败。
    #    bindparam 带 type_=Uuid：SQLite 按 CHAR(32) hex 落库 / PG 原生 uuid，dialect 无关。
    conn = op.get_bind()
    id_param = sa.bindparam("id", type_=sa.Uuid(as_uuid=True))
    change_name_param = sa.bindparam("change_name", type_=sa.String())
    stmt_update_id = sa.text(
        "UPDATE platform_change_progress SET id = :id WHERE change_name = :change_name"
    ).bindparams(id_param, change_name_param)
    rows = conn.execute(sa.text("SELECT change_name FROM platform_change_progress")).fetchall()
    for (change_name,) in rows:
        conn.execute(
            stmt_update_id,
            {"id": uuid.uuid4(), "change_name": change_name},
        )

    # ── 3. batch（copy-and-move 重建）：id NOT NULL + change_name 去主键 + id 设主键 ──
    #    PK 约束名 dialect 不同：SQLite 合成 ``pk_<table>``，PG 默认 ``<table>_pkey``。
    #    在线反射真实名；离线（``--sql`` 无 DB 连接）无法反射，按 dialect 默认命名回退。
    dialect_name = getattr(getattr(conn, "dialect", None), "name", None)
    pk_name = (
        "pk_platform_change_progress"
        if dialect_name == "sqlite"
        else ("platform_change_progress_pkey")
    )
    try:
        reflected_pk = sa.inspect(conn).get_pk_constraint("platform_change_progress")["name"]
        if reflected_pk:
            pk_name = reflected_pk
    except Exception:
        pass  # 离线模式（--sql 生成）：无连接，用 dialect 默认命名
    with op.batch_alter_table("platform_change_progress", schema=None) as batch_op:
        # 复合唯一约束不动：SQLite 上它是唯一索引，batch copy 随表自动搬运（复制期间
        # 保留索引），重建后仍在；PG batch 为 no-op 直接 ALTER 不受影响。
        # （不要试图在 batch 内 drop_constraint(type_="unique")——SQLite 反射为 Index
        # 而非 UniqueConstraint，batch 找不到该约束名会 ValueError。）
        batch_op.alter_column(
            "id",
            existing_type=sa.Uuid(as_uuid=True),
            existing_nullable=True,
            nullable=False,
        )
        if dialect_name != "sqlite":
            # PG：旧 PK 有名（platform_change_progress_pkey），batch 为 no-op 直接
            # ALTER，须先 drop 旧主键再建新主键。
            batch_op.drop_constraint(pk_name, type_="primary")
        # SQLite：反射的旧 PK 无名，drop_constraint 按名找不到会 ValueError；
        # create_primary_key 的 add_constraint 对 PK 特殊处理，会自动移除旧无名 PK
        # （batch copy 重建时不再带上）。SQLAlchemy 对「旧列 PK 标记 + 新 PK 不匹配」
        # 会发 SAWarning，但重建结果正确（id 为唯一主键）——已知 SQLite 无名 PK 限制。
        batch_op.create_primary_key("pk_platform_change_progress", ["id"])


def downgrade() -> None:
    """结构反向不可逆（跨 workspace 同名 change_name 已共存，无法恢复单主键）。"""
    raise NotImplementedError(
        "platform_change_progress 主键已迁移到 id：downgrade 无法安全恢复 change_name "
        "单主键（跨 workspace 同名行在 upgrade 后合法共存，恢复会撞 PK）。"
    )
