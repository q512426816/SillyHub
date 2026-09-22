"""Unit tests for session fork data-plane columns (2026-09-22-session-fork-continuation task-01).

Covers AgentSession fork 三列（fork_of_session_id / fork_at_run_id /
engine_fork_anchor）+ origin 'fork' 值域 + AgentRun.engine_anchor 锚点列。
Pure Python assertions on SQLModel field metadata — no DB required
（口径同 test_agent_session_model）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import Text

from app.modules.agent.model import AgentRun, AgentSession

# ── AgentSession fork 三列契约 ────────────────────────────────────────────────


def test_agent_session_fork_of_session_id_nullable_uuid_fk() -> None:
    """fork_of_session_id：自引用 FK→agent_sessions.id，nullable 默认 None。

    自引用 FK 无 ondelete（会话软删不硬删，对齐 parent_session_id 先例）；
    NULL = 非 fork 会话（存量行零回归）。
    """
    field = AgentSession.model_fields["fork_of_session_id"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.nullable is True
    fks = list(sa_column.foreign_keys)
    assert len(fks) == 1, f"expected 1 FK on fork_of_session_id, got {len(fks)}"
    fk = fks[0]
    assert fk.column.table.name == "agent_sessions"
    assert fk.column.name == "id"


def test_agent_session_fork_at_run_id_nullable_uuid_fk_set_null() -> None:
    """fork_at_run_id：FK→agent_runs.id，ondelete SET NULL，nullable 默认 None。

    run 可硬删（级联清 log/usage 的既有路径），SET NULL 让源 run 删除时锚点
    退化而非挡删。
    """
    field = AgentSession.model_fields["fork_at_run_id"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.nullable is True
    fks = list(sa_column.foreign_keys)
    assert len(fks) == 1, f"expected 1 FK on fork_at_run_id, got {len(fks)}"
    fk = fks[0]
    assert fk.column.table.name == "agent_runs"
    assert fk.column.name == "id"
    assert fk.ondelete == "SET NULL"


def test_agent_session_engine_fork_anchor_nullable_text() -> None:
    """engine_fork_anchor：Text nullable 默认 None（源会话轮末 chain-entry
    消息 UUID 文本，仅 claude 档有值）。"""
    field = AgentSession.model_fields["engine_fork_anchor"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.nullable is True
    assert isinstance(sa_column.type, Text)


def test_agent_session_fork_defaults_none() -> None:
    """只给必填列构造会话，fork 三列默认 None（存量构造点零改动）。"""
    session = AgentSession(user_id=uuid.uuid4(), provider="claude")
    assert session.fork_of_session_id is None
    assert session.fork_at_run_id is None
    assert session.engine_fork_anchor is None


def test_agent_session_fork_of_index_declared() -> None:
    """ix_agent_sessions_fork_of 声明在 __table_args__（防 autogenerate 漂移，
    迁移 20260922194500 同步建）。"""
    table = AgentSession.__table__
    index_names = {idx.name for idx in table.indexes}
    assert "ix_agent_sessions_fork_of" in index_names


# ── origin 'fork' 值域 ───────────────────────────────────────────────────────


def test_agent_session_origin_column_accommodates_fork() -> None:
    """origin 列 String(16) 可容纳 'fork' 值（长度 4 ≤ 16）。"""
    sa_column = AgentSession.model_fields["origin"].sa_column
    assert sa_column.type.length == 16
    assert len("fork") <= sa_column.type.length


def test_agent_session_origin_accepts_fork_value() -> None:
    """构造 origin='fork' 会话落值成功；且 fork 约束（不写 parent_session_id、
    tree_depth 恒 0）的模型侧默认形态：tree_depth 默认 0、parent 默认 None。"""
    session = AgentSession(user_id=uuid.uuid4(), provider="claude", origin="fork")
    assert session.origin == "fork"
    assert session.parent_session_id is None
    assert session.tree_depth == 0


# ── AgentRun.engine_anchor 锚点列 ────────────────────────────────────────────


def test_agent_run_engine_anchor_nullable_text() -> None:
    """engine_anchor：Text nullable 默认 None——仅 claude 档回填轮末
    chain-entry 消息 UUID，codex/pi 恒 NULL；存量 run 行 NULL 不回填。"""
    field = AgentRun.model_fields["engine_anchor"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.nullable is True
    assert isinstance(sa_column.type, Text)
    assert list(sa_column.foreign_keys) == []


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
