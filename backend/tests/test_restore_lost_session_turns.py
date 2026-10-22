"""回灌脚本纯函数与幂等/对账语义测试（FR-03 / FR-04）。

覆盖：
- ``--turn-ids`` 区间/列表解析；
- 归一化消息 → run/log 映射（channel、文本前缀、tool_call JSON、tool_kind 继承、
  change_id=NULL、确定性 run id）；
- ``restore_turns`` 重复执行不重复插入；
- ``turn_count`` 对账：保守模式仅下调虚高，exact 模式对齐实际值。
"""

from __future__ import annotations

import importlib.util
import uuid
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession

_SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "restore_lost_session_turns.py"
_spec = importlib.util.spec_from_file_location("restore_lost_session_turns", _SCRIPT_PATH)
assert _spec is not None and _spec.loader is not None
restore_script = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(restore_script)

pytestmark = pytest.mark.anyio


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


def _messages(turn_id: int = 1) -> list[dict]:
    return [
        {
            "turn_id": turn_id,
            "seq": 1,
            "kind": "user_input",
            "text": "帮我看看",
            "ts": "2026-10-22T05:12:33.000Z",
        },
        {
            "turn_id": turn_id,
            "seq": 2,
            "kind": "thinking",
            "text": "先看目录",
            "ts": "2026-10-22T05:12:34.000Z",
        },
        {
            "turn_id": turn_id,
            "seq": 3,
            "kind": "tool_use",
            "tool_name": "Bash",
            "tool_input": '{"command":"ls"}',
            "tool_use_id": "call_1",
            "ts": "2026-10-22T05:12:35.000Z",
        },
        {
            "turn_id": turn_id,
            "seq": 4,
            "kind": "tool_result",
            "tool_result": "a.txt",
            "tool_use_id": "call_1",
            "ts": "2026-10-22T05:12:36.000Z",
        },
        {
            "turn_id": turn_id,
            "seq": 5,
            "kind": "reply",
            "text": "看完了",
            "ts": "2026-10-22T05:12:37.000Z",
        },
    ]


def _session(turn_count: int = 0) -> AgentSession:
    return AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        origin="chat",
        agent_session_id="engine-session-x",
        turn_count=turn_count,
    )


def test_parse_turn_ids_range_and_list() -> None:
    assert restore_script.parse_turn_ids("10-12,15") == {10, 11, 12, 15}
    with pytest.raises(ValueError):
        restore_script.parse_turn_ids("12-10")


def test_build_turn_rows_maps_all_kinds() -> None:
    session_id = uuid.uuid4()
    run_kwargs, logs = restore_script.build_turn_rows(
        session_id=session_id,
        engine_session_id="engine-session-x",
        turn_id=1,
        messages=_messages(),
    )
    assert run_kwargs["change_id"] is None
    assert run_kwargs["status"] == "completed"
    assert run_kwargs["metadata_"]["restored_from"] == restore_script.RESTORE_MARKER
    assert run_kwargs["num_turns"] == 1
    # 确定性 run id
    again, _ = restore_script.build_turn_rows(
        session_id=session_id,
        engine_session_id="engine-session-x",
        turn_id=1,
        messages=_messages(),
    )
    assert again["id"] == run_kwargs["id"]

    channels = [row["channel"] for row in logs]
    assert channels.count("user_input") == 1
    assert channels.count("tool_call") == 1
    assert channels.count("stdout") == 4

    by_channel: dict[str, list[dict]] = {}
    for row in logs:
        by_channel.setdefault(row["channel"], []).append(row)
    assert by_channel["user_input"][0]["content_redacted"] == "帮我看看"
    assert by_channel["stdout"][0]["content_redacted"].startswith("[THINKING]")
    tool_use_stdout = next(
        row for row in by_channel["stdout"] if row["content_redacted"].startswith("[TOOL_USE]")
    )
    assert tool_use_stdout["tool_kind"] is None
    tool_call = by_channel["tool_call"][0]
    assert tool_call["tool_kind"] == "bash"
    assert '"tool": "Bash"' in tool_call["content_redacted"]
    result_row = next(
        row for row in by_channel["stdout"] if row["content_redacted"].startswith("[TOOL_RESULT]")
    )
    assert result_row["tool_kind"] == "bash"  # 从配对 tool_use 继承
    reply_row = next(
        row for row in by_channel["stdout"] if row["content_redacted"].startswith("[ASSISTANT]")
    )
    assert reply_row["metadata_"]["agent_event"]["event_type"] == "text"


async def test_restore_is_idempotent(db_session) -> None:
    session = _session()
    db_session.add(session)
    await db_session.commit()

    grouped = {1: _messages()}
    first = await restore_script.restore_turns(db_session, session, grouped, apply=True)
    assert first["runs_new"] == 1
    assert first["logs_new"] == 6
    assert first["turn_count_after"] == 1

    second = await restore_script.restore_turns(db_session, session, grouped, apply=True)
    assert second["runs_new"] == 0
    assert second["runs_existing"] == 1
    assert second["logs_new"] == 0
    assert second["logs_existing"] == 6

    run_count = (
        await db_session.execute(
            select(func.count(AgentRun.id)).where(AgentRun.agent_session_id == session.id)
        )
    ).scalar_one()
    log_count = (
        await db_session.execute(
            select(func.count(AgentRunLog.id)).where(
                AgentRunLog.run_id.in_(
                    select(AgentRun.id).where(AgentRun.agent_session_id == session.id)
                )
            )
        )
    ).scalar_one()
    assert run_count == 1
    assert log_count == 6

    run = (
        (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == session.id)))
        .scalars()
        .one()
    )
    assert run.change_id is None
    assert run.metadata_["restored_turn_id"] == 1


async def test_reconcile_turn_count_only_lowers_and_exact_mode(db_session) -> None:
    session = _session(turn_count=5)
    db_session.add(session)
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=session.id,
    )
    db_session.add(run)
    db_session.add(
        AgentRunLog(
            id=uuid.uuid4(),
            run_id=run.id,
            timestamp=restore_script._parse_ts("2026-10-22T05:12:33Z"),
            channel="user_input",
            content_redacted="hi",
        )
    )
    await db_session.commit()

    before, after = await restore_script.reconcile_turn_count(db_session, session)
    assert (before, after) == (5, 1)
    assert session.turn_count == 1

    # 已经低于 expected：保守模式不动（tool_report 0 语义）
    session.turn_count = 0
    before, after = await restore_script.reconcile_turn_count(db_session, session)
    assert (before, after) == (0, 0)

    # exact 模式对齐实际值
    before, after = await restore_script.reconcile_turn_count(db_session, session, exact=True)
    assert (before, after) == (0, 1)
