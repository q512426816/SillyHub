"""reset_agent_log_attribution 运维脚本的 DML 语义测试（2026-09-13 部署裁决）。

背景：20260912050000 迁移的破坏性清库 DML 抽出到 backend/scripts/
reset_agent_log_attribution.py（compose 自动前滚与 DG-03 手动时序矛盾的解法，
详见迁移文件 docstring）。本测试钉死脚本与原迁移 DML 逐条对齐的语义：

- 归属列清空只动 agent_session_id（行保留）；
- tool_report 软删只命中 origin='tool_report' 且未删行（chat 会话不动、
  已软删行不重打时间戳）；
- 两张 links 表全清；
- apply_reset 不提交——事务边界归调用方（脚本 main 单事务提交）；
- collect_counts 与 apply_reset 判定同口径（dry-run 计数 == 实际受影响行数）。
"""

from __future__ import annotations

import importlib.util
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.workspace.model import Workspace

# scripts/ 不是包，按文件路径加载模块（迁移测试 importlib.import_module 先例的路径版）。
_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "reset_agent_log_attribution.py"
_spec = importlib.util.spec_from_file_location("reset_agent_log_attribution", _SCRIPT_PATH)
assert _spec is not None and _spec.loader is not None
reset_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(reset_script)

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


async def _seed(db_session: AsyncSession):
    """三会话（活 tool_report / 已软删 tool_report / chat）+ 两条日志（一有一无归属）+ 两张 links 各一行。"""
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"rst-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    ws = Workspace(
        id=uuid.uuid4(),
        name="rst-ws",
        slug=f"rst-ws-{uuid.uuid4().hex[:8]}",
        root_path="C:/tmp/rst-ws",
        status="active",
    )
    db_session.add(ws)
    now = datetime.now(UTC)
    live_tr = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="active",
        turn_count=0,
        created_at=now,
        origin="tool_report",
    )
    dead_tr_ts = datetime.now(UTC)
    dead_tr = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="ended",
        turn_count=0,
        created_at=now,
        origin="tool_report",
        deleted_at=dead_tr_ts,
    )
    chat = AgentSession(
        id=uuid.uuid4(),
        user_id=uid,
        provider="claude",
        status="active",
        turn_count=0,
        created_at=now,
        origin="chat",
    )
    db_session.add_all([live_tr, dead_tr, chat])
    db_session.add(
        AgentSessionLogORM(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            log_path="/a.jsonl",
            harness="claude",
            agent_session_id=live_tr.id,
        )
    )
    db_session.add(
        AgentSessionLogORM(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            log_path="/b.jsonl",
            harness="claude",
            agent_session_id=None,
        )
    )
    # links：FK（changes/workspaces/agent_sessions）在测试引擎未开 PRAGMA，
    # change_id 指向不存在的行不受限——与既有迁移测试同口径。
    db_session.add(ChangeSessionLink(id=uuid.uuid4(), change_id=uuid.uuid4(), session_id=chat.id))
    db_session.add(
        QuicklogSessionLink(
            id=uuid.uuid4(), workspace_id=ws.id, ql_id="ql-test-1", session_id=chat.id
        )
    )
    await db_session.commit()
    return {
        "live_tr": live_tr,
        "dead_tr": dead_tr,
        "chat": chat,
        "ws": ws,
        "dead_tr_ts": dead_tr_ts,
    }


async def test_apply_reset_semantics(db_session: AsyncSession) -> None:
    env = await _seed(db_session)
    conn = await db_session.connection()

    before = await reset_script.collect_counts(conn)
    assert before == {
        # 全表行数口径（两条日志都计——UPDATE 无 WHERE，NULL→NULL 同计 rowcount）。
        "logs_attributed_cleared": 2,
        "tool_report_sessions_soft_deleted": 1,
        "change_session_links_deleted": 1,
        "quicklog_session_links_deleted": 1,
    }

    counts = await reset_script.apply_reset(conn)
    # dry-run 计数与实际受影响行数严格同口径。
    assert counts == before

    # 归属列清空、行保留（两条日志都在，agent_session_id 全 NULL）。
    logs = (
        (
            await db_session.execute(
                select(AgentSessionLogORM.agent_session_id).order_by(AgentSessionLogORM.log_path)
            )
        )
        .scalars()
        .all()
    )
    assert logs == [None, None]
    # 活 tool_report 已软删；已软删的时间戳不重打；chat 会话不动——裸 SQL 绕过
    # ORM（identity map 是旧对象），统一走全新 core 查询断言库内真实状态。
    rows = {
        sid: (deleted_at, origin)
        for sid, deleted_at, origin in (
            await db_session.execute(
                select(AgentSession.id, AgentSession.deleted_at, AgentSession.origin).where(
                    AgentSession.id.in_([env["live_tr"].id, env["dead_tr"].id, env["chat"].id])
                )
            )
        ).all()
    }
    live_row = rows[env["live_tr"].id]
    dead_row = rows[env["dead_tr"].id]
    chat_row = rows[env["chat"].id]
    assert live_row[0] is not None and live_row[1] == "tool_report"
    # SQLite 回读丢 tzinfo（既有 quota 测试同款坑）——naive 归一后比对。
    assert dead_row[0] is not None and dead_row[0].replace(tzinfo=None) == env[
        "dead_tr_ts"
    ].replace(tzinfo=None)
    assert chat_row[0] is None and chat_row[1] == "chat"
    # 两张 links 表清空。
    assert (await db_session.execute(select(ChangeSessionLink.id))).scalars().all() == []
    assert (await db_session.execute(select(QuicklogSessionLink.id))).scalars().all() == []


async def test_apply_reset_does_not_commit(db_session: AsyncSession) -> None:
    """apply_reset 不提交——事务边界归调用方（脚本 main 单事务提交）。"""
    await _seed(db_session)
    conn = await db_session.connection()
    await reset_script.apply_reset(conn)
    await db_session.rollback()
    # 回滚后数据原样（未提交的清库不落）。
    attributed = await db_session.execute(
        select(AgentSessionLogORM.id).where(AgentSessionLogORM.agent_session_id.is_not(None))
    )
    assert attributed.scalars().first() is not None
