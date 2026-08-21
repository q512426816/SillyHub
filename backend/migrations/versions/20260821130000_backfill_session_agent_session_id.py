"""20260821120000_backfill_session_agent_session_id

Revision ID: 20260821130000
Revises: 20260821120000
Create Date: 2026-08-21

存量会话 SDK resume key 一次性回填（task-02 / DS-2，变更
2026-08-21-session-reopen-resume / FR-02 / NFR-04）。

背景：reopen（POST /sessions/{id}/reopen）硬依赖 ``agent_sessions.agent_session_id``
（SDK resume key，空则 409），但该列历史上无生产代码写入，存量交互会话全 NULL。
daemon 每轮上报的 SDK 会话 id 已流入 ``agent_runs.session_id``（仅空时写，D-001@v1），
数据在库只是没回填——本迁移把它搬进会话行。

取值规则：为 ``agent_session_id IS NULL`` 且 ``provider IN ('claude','codex')`` 且
``deleted_at IS NULL`` 的会话，取其 ``agent_runs`` 中 ``created_at`` 最新且
``session_id`` 非空那条的值（fork 场景取最新 id）。无合格 run 的老会话保持 NULL
（reopen 维持 409，预期内，design 风险表已登记：这类旧会话 SDK transcript 可能
已不存在，本就无法恢复）。

职责分离：本迁移只补空（``agent_session_id IS NULL``），绝不覆盖已有值；增量
「最新值覆盖」由 task-01 的 submit_messages 回填负责。

纯 data migration（零结构变更：无 add_column/drop_column/create_index）。
downgrade 为 no-op（不可逆）：回填后原 NULL 已无法区分「从未上报」与「回填后
清空」，且本项目允许重置开发/测试数据（CLAUDE.md 规则 11）。

注：revision id ≤32 字符（alembic_version.version_num varchar(32)）。
SQLite 测试兼容性按 zombie 迁移先例处理（tests/test_session_agent_session_id_
migration.py 用 SQLite 等价 SQL replay 验证取值逻辑）；真实 PG
``alembic upgrade head`` 为 manual verify。

author: qinyi
created_at: 2026-08-21
"""

from __future__ import annotations

from typing import Sequence

from alembic import op

revision: str = "20260821130000"
down_revision: str | None = "20260821120000"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # 单条 raw SQL 数据迁移（PG 方言）。子查询 ORDER BY r.created_at DESC LIMIT 1
    # 取最后一轮 run 的 session_id（fork 场景取最新 id）；r.session_id IS NOT NULL
    # 排除老数据 NULL 行。agent_runs.created_at 列由 202607050900_add_agent_run_
    # created_at 迁移保证存在。三重 WHERE 守卫：仅补空 + provider 限定 claude/codex
    # （其余 provider 的 resume 机制不同，不回填）+ 排除软删行。
    op.execute(
        """
        UPDATE agent_sessions s
        SET agent_session_id = (
            SELECT r.session_id FROM agent_runs r
            WHERE r.agent_session_id = s.id
              AND r.session_id IS NOT NULL
            ORDER BY r.created_at DESC
            LIMIT 1
        )
        WHERE s.agent_session_id IS NULL
          AND s.provider IN ('claude', 'codex')
          AND s.deleted_at IS NULL
        """
    )


def downgrade() -> None:
    # 不可逆 no-op：回填后原 NULL 已无法区分「从未上报」与「回填后清空」，无法
    # 甄别哪些行该还原；本项目未正式上线、允许重置开发/测试数据（CLAUDE.md
    # 规则 11），不写回滚 SQL。重跑 upgrade 亦幂等（仅命中 IS NULL 行）。
    pass
