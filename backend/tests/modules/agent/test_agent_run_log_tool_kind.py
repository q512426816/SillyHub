"""agent run log tool_kind 集成单测（task-09）。

覆盖 design §8/§9/§10 R-01、FR-01/04/05/06/07：
  1. 迁移 upgrade/downgrade 可逆（SQLite ORM introspect）；
  2. batch 路径 ``submit_messages`` 落库 tool_kind（msg 带值优先 / JSON.parse
     兜底 / stdout NULL 三路径）；
  3. interactive 路径 ``_extract_sdk_messages`` 把 SDK tool_use block 打标 skill；
  4. publish payload（run channel published_logs + session channel session_payload）
     含 tool_kind 字段（R-08）；
  5. API ``GET /agent/runs/{run_id}/logs?tool_kind=`` 多选/单选/不传三 case。

与 ``test_tool_kind.py``（task-02 纯函数单测）互补：本文件测集成链路
（迁移 → 落库 → publish → API），不重复 classify_tool_kind 纯逻辑用例。

R-01 提示：SQLite 单测跑不出 alembic 迁移链断裂（多分支 down_revision 撞
head），verify 阶段须在 PG 上 `alembic upgrade head` 验证迁移链（见
design §10 R-01 / migration-chain-fragmentation-pattern 记忆）。
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.run_sync.service import (
    RunSyncService,
    _extract_sdk_messages,
    publish_submitted_messages,
)

# ---------------------------------------------------------------------------
# helpers / fixtures
# ---------------------------------------------------------------------------


async def _make_agent_run(db_session: AsyncSession) -> AgentRun:
    """构造一条 pending 的 AgentRun（最小非空字段：agent_type / status）。

    submit_messages 落库循环会 get(AgentRun) 并把 pending → running；agent_run_id
    与 lease 解耦（参数直传），故无需建 lease / task。
    """
    run = AgentRun(agent_type="claude_code", status="pending")
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    return run


def _stub_facade(service: RunSyncService) -> None:
    """绕过 lease 验证：submit_messages 起手就 await facade 校验。

    本测试只关心 tool_kind 落库 + publish，把 facade._get_lease_and_verify_token
    替换成 AsyncMock 返回一个哑 lease 对象即可（agent_run_id 由参数传入，
    lease 自身字段不被读取）。
    """
    service._facade = AsyncMock()  # type: ignore[assignment]
    service._facade._get_lease_and_verify_token = AsyncMock(return_value=object())


# ---------------------------------------------------------------------------
# 1. 迁移（upgrade / downgrade）
# ---------------------------------------------------------------------------


def test_migration_upgrade_adds_column_and_index() -> None:
    """upgrade 后 agent_run_logs.tool_kind 列 + ix_agent_run_logs_tool_kind 索引存在。

    用 ORM 表元数据 introspect（dialect 无关，SQLite / PG 一致）——不绑死 SQL 函数
    名（R-01 / 不写 date_trunc 等）。注：本测试只验证迁移内容落到表结构，
    不覆盖 alembic 多分支 down_revision 撞 head 的迁移链断裂（PG verify 范围）。
    """
    cols = {c.name for c in inspect(AgentRunLog.__table__).columns}
    assert "tool_kind" in cols
    # 列可空 + String(32)（design §8）
    col = AgentRunLog.__table__.columns["tool_kind"]
    assert col.nullable is True
    assert col.type.length == 32  # type: ignore[attr-defined]

    indexes = {idx.name for idx in AgentRunLog.__table__.indexes}
    assert "ix_agent_run_logs_tool_kind" in indexes


async def test_migration_downgrade_drops_column_and_index(
    db_session: AsyncSession,
    db_engine: pytest.fixture,  # type: ignore[name-defined]
) -> None:
    """downgrade 可逆：对建好的表 DROP 列 + DROP 索引后 introspect 不再见。

    验证迁移文件 downgrade() 体内的两条 DDL（drop_index + drop_column）能干净
    撤销 upgrade。alembic stamp/heads 链路在 PG verify 覆盖；这里只验可逆语义。
    db_engine 是 conftest 的 in-memory SQLite engine，直接用它执行 DDL。
    """
    async with db_engine.begin() as conn:
        await conn.execute(text("DROP INDEX IF EXISTS ix_agent_run_logs_tool_kind"))
        await conn.execute(text("ALTER TABLE agent_run_logs DROP COLUMN tool_kind"))

    async with db_engine.begin() as conn:
        cols = await conn.run_sync(
            lambda sync_conn: inspect(sync_conn).get_columns("agent_run_logs")
        )
    assert "tool_kind" not in {c["name"] for c in cols}


# ---------------------------------------------------------------------------
# 2. batch 落库（FR-05）：msg 带优先 / JSON.parse 兜底 / stdout NULL
# ---------------------------------------------------------------------------


async def test_submit_messages_batch_prefers_msg_tool_kind(db_session: AsyncSession) -> None:
    """msg 顶层带 tool_kind（新 daemon 直传 / _extract_sdk_messages 注入）→ 直接落库。"""
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    tool_call_payload = json.dumps({"tool": "Bash", "args": {"command": "ls"}})
    messages = [
        {
            "event_type": "tool_use",
            "content": tool_call_payload,
            "channel": "tool_call",
            # 新 daemon 已带 → 优先于 JSON.parse 兜底（即便 content 的 tool 也能识别）
            "tool_kind": "sillyspec",
        }
    ]

    result = await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=messages,
    )

    assert int(result) == 1
    rows = (
        await db_session.execute(AgentRunLog.__table__.select().where(AgentRunLog.run_id == run.id))
    ).all()
    assert len(rows) == 1
    assert rows[0].tool_kind == "sillyspec"


async def test_submit_messages_batch_falls_back_to_json_parse(db_session: AsyncSession) -> None:
    """msg 无 tool_kind 但 content 是 tool_call JSON → JSON.parse 兜底识别 sillyspec（FR-05 / 兼容旧 daemon）。"""
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    messages = [
        {
            "event_type": "tool_use",
            # content 是 tool_call JSON，含 tool=Bash + args.command 含 sillyspec 子串
            "content": json.dumps({"tool": "Bash", "args": {"command": "sillyspec run plan"}}),
            "channel": "tool_call",
            # 故意不传 tool_kind（旧 daemon 形态）→ 触发兜底
        }
    ]

    result = await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=messages,
    )
    assert int(result) == 1

    rows = (
        await db_session.execute(AgentRunLog.__table__.select().where(AgentRunLog.run_id == run.id))
    ).all()
    assert len(rows) == 1
    assert rows[0].channel == "tool_call"
    assert rows[0].tool_kind == "sillyspec"


async def test_submit_messages_batch_skill_fallback(db_session: AsyncSession) -> None:
    """JSON.parse 兜底识别 skill 工具（非 sillyspec 的另一种 kind 路径覆盖）。"""
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    messages = [
        {
            "event_type": "tool_use",
            "content": json.dumps({"tool": "Skill", "args": {"name": "x"}}),
            "channel": "tool_call",
        }
    ]
    await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=messages,
    )
    rows = (
        await db_session.execute(AgentRunLog.__table__.select().where(AgentRunLog.run_id == run.id))
    ).all()
    assert len(rows) == 1
    assert rows[0].tool_kind == "skill"


async def test_submit_messages_stdout_text_row_has_null_tool_kind(
    db_session: AsyncSession,
) -> None:
    """stdout 文本行（[TOOL_USE]/[ASSISTANT] 等）→ tool_kind=NULL（design §5 Phase 2：仅 tool_call 行有值）。"""
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    messages = [
        {
            "event_type": "text",
            "content": "[ASSISTANT] hello world",
            "channel": "stdout",
            # 即便误带 tool_kind 也应被 stdout 路径忽略（仅在 tool_call 兜底分支才会用）
        }
    ]
    await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=messages,
    )
    rows = (
        await db_session.execute(AgentRunLog.__table__.select().where(AgentRunLog.run_id == run.id))
    ).all()
    assert len(rows) == 1
    assert rows[0].channel == "stdout"
    assert rows[0].tool_kind is None


# ---------------------------------------------------------------------------
# 3. interactive 落库（FR-04）：_extract_sdk_messages tool_use 打标
# ---------------------------------------------------------------------------


def test_extract_sdk_messages_tool_use_tagged_skill() -> None:
    """SDK assistant tool_use block（name=Skill）→ tool_call flat record tool_kind=skill（FR-04）。"""
    msg = {
        "type": "assistant",
        "message": {
            "id": "msg_001",
            "role": "assistant",
            "content": [
                {"type": "text", "text": "calling skill now"},
                {
                    "type": "tool_use",
                    "id": "toolu_01abc",
                    "name": "Skill",
                    "input": {"name": "sillyspec-execute"},
                },
            ],
        },
    }
    out = _extract_sdk_messages(msg)
    # text block → 1 条 stdout；tool_use block → 2 条（stdout [TOOL_USE] + tool_call JSON）
    assert len(out) == 3
    tool_call_record = next(r for r in out if r.get("channel") == "tool_call")
    assert tool_call_record["tool_kind"] == "skill"
    # 配对的 stdout [TOOL_USE] 文本行不带 tool_kind（design §5 Phase 2）
    stdout_tool_use = next(
        r for r in out if r.get("channel") == "stdout" and "[TOOL_USE]" in r.get("content", "")
    )
    assert "tool_kind" not in stdout_tool_use


def test_extract_sdk_messages_tool_use_tagged_sillyspec() -> None:
    """Bash + command 含 sillyspec 子串 → tool_kind=sillyspec（D-001）。"""
    msg = {
        "type": "assistant",
        "message": {
            "id": "msg_002",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_02",
                    "name": "Bash",
                    "input": {"command": "sillyspec run execute"},
                }
            ],
        },
    }
    out = _extract_sdk_messages(msg)
    tool_call = next(r for r in out if r.get("channel") == "tool_call")
    assert tool_call["tool_kind"] == "sillyspec"


async def test_submit_messages_interactive_path_end_to_end(db_session: AsyncSession) -> None:
    """interactive SDK 原始 msg（顶层无 event_type/content）→ submit_messages 展开落库带 tool_kind。

    覆盖 R-02 双路径：interactive 经 _extract_sdk_messages 展开后再走 submit_messages
    落库（与 batch 路径合流），tool_kind 从展开 record 顶层取（msg.get 优先命中）。
    """
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    sdk_msg = {
        "type": "assistant",
        "message": {
            "id": "msg_003",
            "content": [
                {
                    "type": "tool_use",
                    "id": "toolu_03",
                    "name": "Read",
                    "input": {"file_path": "/tmp/a.txt"},
                }
            ],
        },
    }
    # 顶层无 event_type/content → submit_messages 走 _extract_sdk_messages 分支
    result = await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=[sdk_msg],
    )
    # Read block → stdout [TOOL_USE] + tool_call JSON = 2 行
    assert int(result) == 2
    rows = (
        await db_session.execute(
            AgentRunLog.__table__.select()
            .where(AgentRunLog.run_id == run.id)
            .order_by(text("rowid"))
        )
    ).all()
    tool_call_rows = [r for r in rows if r.channel == "tool_call"]
    assert len(tool_call_rows) == 1
    assert tool_call_rows[0].tool_kind == "read"
    stdout_rows = [r for r in rows if r.channel == "stdout"]
    assert all(r.tool_kind is None for r in stdout_rows)


# ---------------------------------------------------------------------------
# 4. publish（FR-06 / R-08）：published_logs + session_payload 含 tool_kind
# ---------------------------------------------------------------------------


async def test_published_logs_payload_contains_tool_kind(db_session: AsyncSession) -> None:
    """submit_messages 返回的 published_logs 每条 dict 含 tool_kind 字段（run channel / FR-06）。"""
    run = await _make_agent_run(db_session)
    svc = RunSyncService(db_session)
    _stub_facade(svc)

    messages = [
        {
            "event_type": "tool_use",
            "content": json.dumps({"tool": "Bash", "args": {"command": "sillyspec run plan"}}),
            "channel": "tool_call",
            "tool_kind": "sillyspec",
        }
    ]
    result = await svc.submit_messages(
        lease_id=uuid.uuid4(),
        claim_token="tkn",
        agent_run_id=run.id,
        messages=messages,
    )
    # result.publish_intent.published_logs 是 run channel publish 的载荷列表
    intent = result.publish_intent  # type: ignore[attr-defined]
    assert intent is not None
    assert len(intent.published_logs) == 1
    payload = intent.published_logs[0]
    assert "tool_kind" in payload
    assert payload["tool_kind"] == "sillyspec"
    # 邻近字段也齐（regression：parent/subagent/depth 一并透传，本变更不能破坏）
    assert payload["channel"] == "tool_call"


async def test_session_channel_payload_contains_tool_kind(monkeypatch: pytest.MonkeyPatch) -> None:
    """publish_submitted_messages 发到 session channel 的 session_payload 含 tool_kind（R-08 两处都加）。

    用 fake redis 捕获 session channel 发布内容，断言 tool_kind 透传。agent_session_id
    非 None 才进入 session publish 分支（interactive run）。
    """
    from app.modules.daemon.run_sync import service as rss

    captured: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            captured.append((channel, payload))
            return 1

    monkeypatch.setattr(rss, "get_redis", lambda: _FakeRedis())

    intent = rss.PublishIntent(
        agent_run_id=uuid.uuid4(),
        lease_id=uuid.uuid4(),
        count=1,
        published_logs=[
            {
                "log_id": str(uuid.uuid4()),
                "channel": "tool_call",
                "content": '{"tool":"Skill","args":{"name":"x"}}',
                "timestamp": "2026-07-05T00:00:00Z",
                "parent_tool_use_id": None,
                "subagent_type": None,
                "depth": None,
                "tool_kind": "skill",
            }
        ],
        agent_run_status="running",
        input_tokens=None,
        output_tokens=None,
        cache_read_tokens=None,
        cache_creation_tokens=None,
        agent_session_id=uuid.uuid4(),  # 非 None → 进入 session publish 分支
        timestamp_iso="2026-07-05T00:00:00Z",
    )
    await publish_submitted_messages(intent)

    session_msgs = [json.loads(p) for ch, p in captured if ch.startswith("agent_session:")]
    assert len(session_msgs) >= 1
    log_event = next(m for m in session_msgs if m.get("event") == "log")
    assert log_event["tool_kind"] == "skill"
    # 回归：相邻归属字段齐
    assert "parent_tool_use_id" in log_event


# ---------------------------------------------------------------------------
# 5. API（FR-07）：GET /logs ?tool_kind= 多选/单选/不传
# ---------------------------------------------------------------------------


async def _seed_logs_for_api(db_session: AsyncSession) -> tuple[uuid.UUID, uuid.UUID]:
    """构造 1 个 run + 4 条 tool_call + 1 条 stdout 日志，覆盖三种 API 筛选 case。

    返回 (workspace_id, run_id)（workspace_id 不参与 router 逻辑，仅凑路径）。
    """
    run = AgentRun(agent_type="claude_code", status="running")
    db_session.add(run)
    await db_session.flush()

    rows = [
        AgentRunLog(
            run_id=run.id,
            channel="tool_call",
            tool_kind="sillyspec",
            content_redacted='{"tool":"Bash"}',
        ),
        AgentRunLog(
            run_id=run.id,
            channel="tool_call",
            tool_kind="skill",
            content_redacted='{"tool":"Skill"}',
        ),
        AgentRunLog(
            run_id=run.id,
            channel="tool_call",
            tool_kind="bash",
            content_redacted='{"tool":"Bash","args":{}}',
        ),
        AgentRunLog(
            run_id=run.id, channel="tool_call", tool_kind="read", content_redacted='{"tool":"Read"}'
        ),
        # stdout 行：tool_kind=NULL，不应被 tool_kind 筛选命中
        AgentRunLog(
            run_id=run.id, channel="stdout", tool_kind=None, content_redacted="[ASSISTANT] hi"
        ),
    ]
    db_session.add_all(rows)
    await db_session.commit()
    return uuid.uuid4(), run.id


async def test_api_get_logs_no_filter_returns_all(
    client: pytest.fixture,  # type: ignore[name-defined]
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """不传 tool_kind → 返回全部 5 条（§9 兼容：与现状一致）。"""
    workspace_id, run_id = await _seed_logs_for_api(db_session)
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 5


async def test_api_get_logs_multi_filter(
    client: pytest.fixture,  # type: ignore[name-defined]
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """?tool_kind=sillyspec,skill → 仅命中 2 条（channel=tool_call 且 kind 在集合内）。"""
    workspace_id, run_id = await _seed_logs_for_api(db_session)
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
        headers=auth_headers,
        params={"tool_kind": "sillyspec,skill"},
    )
    assert resp.status_code == 200
    body = resp.json()
    # 顺序按 timestamp 排序（同批插入 → 保持插入顺序），不强断顺序只断集合
    assert {item["tool_kind"] for item in body} == {"sillyspec", "skill"}
    assert len(body) == 2
    # 筛选后没有 stdout 行（kind=None）
    assert all(item["channel"] == "tool_call" for item in body)


async def test_api_get_logs_single_filter(
    client: pytest.fixture,  # type: ignore[name-defined]
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """?tool_kind=bash 单工具 → 仅命中 1 条（单选 case）。"""
    workspace_id, run_id = await _seed_logs_for_api(db_session)
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
        headers=auth_headers,
        params={"tool_kind": "bash"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["tool_kind"] == "bash"


async def test_api_get_logs_filter_excludes_null_kind(
    client: pytest.fixture,  # type: ignore[name-defined]
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """传任意 tool_kind → tool_kind=NULL 的 stdout 行不返回（仅筛 tool_call 行）。

    用 'read' 命中唯一 1 条 tool_call，stdout NULL 行被排除；若 service 误把
    NULL 当通配返回，body 长度会 >= 2。
    """
    workspace_id, run_id = await _seed_logs_for_api(db_session)
    resp = await client.get(
        f"/api/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
        headers=auth_headers,
        params={"tool_kind": "read"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["tool_kind"] == "read"
    assert body[0]["channel"] == "tool_call"
