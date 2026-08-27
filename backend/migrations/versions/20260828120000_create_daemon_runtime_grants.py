"""daemon_runtime_grants 统一授权表 + daemon_borrow_audit.grant_id + 存量 shared 迁移

Revision ID: 20260828120000
Revises: 20260827230000
Create Date: 2026-08-28 12:00:00

Change 2026-08-28-daemon-agent-share task-01（FR-01/FR-04 / D-006@v1 / D-008@v1 /
design §5 Phase 1、§8）：

1. 建 ``daemon_runtime_grants`` 表（模型：app/modules/daemon/grants/model.py）——
   唯一约束 (daemon_instance_id, grantee_type, grantee_id, granted_by_user_id) 以
   **NULLS NOT DISTINCT** 下发（sa.UniqueConstraint postgresql_nulls_not_distinct
   方言 kwarg，SQLAlchemy 2.0.22+；PG16 部署方言生效。SQLite 下 kwarg 被方言忽略
   退化为普通 UNIQUE，测试环境可 replay）——platform 行 grantee_id=NULL，PG 默认
   NULLS DISTINCT 语义 NULL≠NULL 会使唯一约束失效、允许重复建共享智能体行
   （D-008@v1 / Grill B-02）。
2. ``daemon_borrow_audit`` 加 ``grant_id`` UUID nullable 列（无 FK 硬约束——
   grant 物理删除后审计行仍可读；模型侧 agent/model.py 同步加列）。
3. 存量迁移：``workspace_member_runtimes.shared=TRUE`` 行逐条生成 workspace 级
   grant（grantee_id=workspace_id、granted_by=binding.user_id、
   daemon_instance_id=binding.daemon_id、enabled=true）。**daemon_id IS NULL 的
   shared 行跳过**（现存此类 binding，原借用 SQL 本就过滤——D-008@v1 / Grill
   B-03）并 print 日志含跳过计数。项目未上线允许直接迁移（CLAUDE.md 规则 11），
   ``shared`` 列保留不动（UI 缓存，开关双写归 task-06）。

down_revision 接执行时唯一 head 20260827230000（add_agent_runs_ctx_tokens，
alembic heads 实测单 head），单 head 接续不分叉。

downgrade 对称删列 + 删表（存量迁移行随表删除，shared 列未动无需还原）。

author: qinyi
created_at: 2026-08-28 12:00:00
"""

from __future__ import annotations

import uuid
from typing import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260828120000"
down_revision: str | None = "20260827230000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# 存量迁移数据源/目标的最小列集（免 ORM import，方言中性——sa.table 仅作 SQL
# 编译载体，不触发模型注册；列类型供 SQLite/PG 双方言参数绑定）。
_WMR = sa.table(
    "workspace_member_runtimes",
    sa.column("workspace_id", sa.Uuid()),
    sa.column("user_id", sa.Uuid()),
    sa.column("daemon_id", sa.Uuid()),
    sa.column("shared", sa.Boolean()),
)
_GRANTS = sa.table(
    "daemon_runtime_grants",
    sa.column("id", sa.Uuid()),
    sa.column("daemon_instance_id", sa.Uuid()),
    sa.column("grantee_type", sa.String()),
    sa.column("grantee_id", sa.Uuid()),
    sa.column("granted_by_user_id", sa.Uuid()),
    sa.column("enabled", sa.Boolean()),
)


def upgrade() -> None:
    # ① 建表 + ② 审计加列（DDL 段独立成函数：单测用它对 PG 方言 mock engine 断言
    # NULLS NOT DISTINCT 真的下发，SQLite replay 则走完整 upgrade）。
    _create_tables()
    # ③ 存量迁移：shared=TRUE 行逐条生成 workspace grant，跳过 daemon_id NULL 行。
    _backfill_shared_bindings_as_grants()


def _create_tables() -> None:
    """① daemon_runtime_grants 建表（约束/索引与 grants/model.py 逐列对齐）② 审计加列。"""
    op.create_table(
        "daemon_runtime_grants",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True, nullable=False),
        sa.Column(
            "daemon_instance_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("daemon_instances.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("grantee_type", sa.String(20), nullable=False),
        sa.Column("grantee_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column(
            "granted_by_user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # —— platform 绑定列（service 层强制非空，本层可空）——
        sa.Column("agent_profile_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("source_workspace_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("pinned_runtime_id", sa.Uuid(as_uuid=True), nullable=True),
        sa.Column("writable_dir", sa.String(), nullable=True),
        sa.Column(
            "enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        # D-008@v1：NULLS NOT DISTINCT——platform 行 grantee_id=NULL 的唯一性保障。
        sa.UniqueConstraint(
            "daemon_instance_id",
            "grantee_type",
            "grantee_id",
            "granted_by_user_id",
            name="uq_daemon_runtime_grants",
            postgresql_nulls_not_distinct=True,
        ),
    )
    op.create_index(
        "ix_daemon_runtime_grants_grantee",
        "daemon_runtime_grants",
        ["grantee_type", "grantee_id"],
    )
    op.create_index(
        "ix_daemon_runtime_grants_lender",
        "daemon_runtime_grants",
        ["granted_by_user_id"],
    )

    # ② daemon_borrow_audit 加 grant_id（nullable、无 FK 硬约束，design §8）。
    op.add_column(
        "daemon_borrow_audit",
        sa.Column("grant_id", sa.Uuid(as_uuid=True), nullable=True),
    )


def _backfill_shared_bindings_as_grants() -> None:
    """遍历 shared=TRUE 的 member runtime binding，逐条生成 workspace 级 grant。

    D-008@v1 / Grill B-03：daemon_id IS NULL 的 shared binding（现存此类行，
    原借用 SQL 本就过滤）跳过并计数，日志 print 输出迁移/跳过计数。
    created_at/updated_at 交给列 server_default（now()），enabled 显式写 true。
    """
    conn = op.get_bind()
    rows = conn.execute(
        sa.select(
            _WMR.c.workspace_id,
            _WMR.c.user_id,
            _WMR.c.daemon_id,
        ).where(_WMR.c.shared.is_(True))
    ).fetchall()
    migrated = 0
    skipped = 0
    for workspace_id, user_id, daemon_id in rows:
        if daemon_id is None:
            skipped += 1
            continue
        conn.execute(
            _GRANTS.insert().values(
                id=uuid.uuid4(),
                daemon_instance_id=daemon_id,
                grantee_type="workspace",
                grantee_id=workspace_id,
                granted_by_user_id=user_id,
                enabled=True,
            )
        )
        migrated += 1
    print(
        f"[20260828120000_create_daemon_runtime_grants] "
        f"migrated {migrated} shared binding(s) -> workspace grant(s); "
        f"skipped {skipped} row(s) with daemon_id IS NULL (D-008@v1)"
    )


def downgrade() -> None:
    op.drop_column("daemon_borrow_audit", "grant_id")
    op.drop_index("ix_daemon_runtime_grants_lender", table_name="daemon_runtime_grants")
    op.drop_index("ix_daemon_runtime_grants_grantee", table_name="daemon_runtime_grants")
    op.drop_table("daemon_runtime_grants")
