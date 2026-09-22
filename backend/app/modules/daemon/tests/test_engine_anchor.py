"""轮引擎锚回填测试（2026-09-22-session-fork-continuation task-04 / FR-07）。

D-011 消费端语义：submit_messages 轮终态收口（_submit_finalize）从本轮
**新落库**消息的 ``AgentEvent.metadata['engineAnchor']``（task-06 双 driver
补挂：claude=assistant 帧链 UUID、pi=轮首 user 消息 entryId）分档回填
``AgentRun.engine_anchor``（task-01 新列），供 fork 服务 native 档取锚。

分档（D-010 / D-011）：
  - claude → 轮内最新（末条带锚消息）覆盖写，轮末收敛到末 chain-entry UUID；
  - pi    → 轮首 user 消息 entryId 仅空时写（entryId 轮内恒定，首写即终值）；
  - codex / 无键 / 空轮 → 不写（NULL=分叉入口灰，不伪造）。

用例六组（卡 task-04）：claude 末条优先 / pi 轮首锚 / codex 不写 / 空轮
不写 / 无 metadata 键不写 / 重复提交不覆盖（锚取轮内最新——dedup 拦下的
重试旧锚不得回退已写入的轮末锚）。

夹具范式镜像 ``test_run_sync_agent_session_id_backfill.py``（session_id
回填点同款测试形态；mocked redis + placement 建 interactive lease + 直接
ORM 落 session/run 行）。新轨消息形态 ``{"kind": "agent_event",
"event": {...}}``（daemon eventToReportDict wire 契约）。

Production code: app/modules/daemon/run_sync/service/submit_commit.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService

# ── Fixtures（对齐 test_run_sync_agent_session_id_backfill） ────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ea-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession, user_id: uuid.UUID, provider: str
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"daemon-{provider}",
        provider=provider,
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _seed_interactive_run(
    db_session: AsyncSession,
    *,
    provider: str,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, str]:
    """建指定 provider 的 interactive session + lease + pending run。

    返回 (agent_session_id, lease_id, run_id, claim_token)。session 与 run
    的 provider 同值（生产创建链 create/inject/ppm_activation 均如此写），
    收口分档按 run.provider 判定。
    """
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid, provider)
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=uid,
        provider=provider,
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=uid,
        provider=provider,
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=dispatch.lease_id,
        agent_session_id=None,
        workspace_id=None,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider=provider,
        status="pending",
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return session_id, dispatch.lease_id, run_id, dispatch.claim_token


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    # submit_messages 已迁 RunSyncService；session/lease 路径仍走 facade，一并 patch。
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


def _agent_event_message(
    content: str,
    *,
    engine_anchor: str | None = None,
    dedup_key: str | None = None,
    event_type: str = "text",
) -> dict[str, Any]:
    """新轨消息（daemon eventToReportDict wire 形态）。

    ``engine_anchor`` 模拟 task-06 driver 补挂的
    ``AgentEvent.metadata.engineAnchor``；``dedup_key`` 模拟 ResilienceService
    注入的幂等键（Claude msg.id / runId:seq）。
    """
    ev: dict[str, Any] = {"type": event_type, "content": content}
    if engine_anchor is not None:
        ev["metadata"] = {"engineAnchor": engine_anchor}
    msg: dict[str, Any] = {"kind": "agent_event", "event": ev}
    if dedup_key is not None:
        msg["dedup_key"] = dedup_key
    return msg


async def _run_engine_anchor(db_session: AsyncSession, run_id: uuid.UUID) -> str | None:
    """读回 run.engine_anchor（expire 后独立 get，避开 identity map 旧值）。"""
    db_session.expire_all()
    run = await db_session.get(AgentRun, run_id)
    assert run is not None
    return run.engine_anchor


# ── Tests ────────────────────────────────────────────────────────────────────


class TestEngineAnchorBackfill:
    @pytest.mark.asyncio
    async def test_claude_round_takes_last_anchor(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """claude 轮：多条带锚消息同批落库 → 取**末条**带锚消息值（D-010 轮末
        chain-entry 语义）；后续批次带新锚 → 覆盖为更新值。同时校验数据面：
        锚经 metadata_['agent_event']['metadata']['engineAnchor'] 落库。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="claude"
        )
        svc = DaemonService(db_session)

        # 同批三条：A（锚 a）→ 无锚 → B（锚 b）→ 轮末锚必须是 b。
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                _agent_event_message("first reply", engine_anchor="chain-uuid-a"),
                _agent_event_message("tool chatter"),
                _agent_event_message("final reply", engine_anchor="chain-uuid-b"),
            ],
        )
        assert result == 3
        assert await _run_engine_anchor(db_session, run_id) == "chain-uuid-b"

        # 数据面：消息行持久化了 agent_event.metadata.engineAnchor（D-011 通道）。
        logs = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        assert len(logs) == 3
        anchors: set[str] = set()
        for row in logs:
            ev_metadata = (row.metadata_ or {}).get("agent_event", {}).get("metadata")
            if isinstance(ev_metadata, dict) and ev_metadata.get("engineAnchor") is not None:
                anchors.add(str(ev_metadata["engineAnchor"]))
        assert anchors == {"chain-uuid-a", "chain-uuid-b"}

        # 后续批次带更新锚（轮内流式续写）→ 覆盖为轮内最新。
        result2 = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("follow-up reply", engine_anchor="chain-uuid-c")],
        )
        assert result2 == 1
        assert await _run_engine_anchor(db_session, run_id) == "chain-uuid-c"

    @pytest.mark.asyncio
    async def test_pi_round_takes_first_anchor(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """pi 轮：轮首 user 消息 entryId（本轮内容事件携带的同值锚）→ 首条带锚
        消息值写入；后续上报**不覆盖**（entryId 轮内恒定，仅空时写语义）。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="pi"
        )
        svc = DaemonService(db_session)

        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [
                _agent_event_message("answer part 1", engine_anchor="entry-42"),
                _agent_event_message("answer part 2", engine_anchor="entry-42"),
            ],
        )
        assert result == 2
        assert await _run_engine_anchor(db_session, run_id) == "entry-42"

        # 同轮后续上报（即便锚值异常不同）不得覆盖轮首锚。
        result2 = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("late flush", engine_anchor="entry-99")],
        )
        assert result2 == 1
        assert await _run_engine_anchor(db_session, run_id) == "entry-42"

    @pytest.mark.asyncio
    async def test_codex_round_never_writes(self, db_session: AsyncSession, mocked_redis) -> None:
        """codex 轮：即便消息带 engineAnchor 键（防御异构 payload）也不写——
        codex 恒 NULL（D-010 分档），消息照常落库。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="codex"
        )
        svc = DaemonService(db_session)

        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("codex reply", engine_anchor="should-never-write")],
        )
        assert result == 1  # 消息照常入库
        assert await _run_engine_anchor(db_session, run_id) is None

    @pytest.mark.asyncio
    async def test_empty_round_no_write(self, db_session: AsyncSession, mocked_redis) -> None:
        """空轮（无消息提交）→ 不写，engine_anchor 保持 NULL。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="claude"
        )
        svc = DaemonService(db_session)

        result = await svc.submit_messages(lease_id, token, run_id, [])
        assert result == 0
        assert await _run_engine_anchor(db_session, run_id) is None

    @pytest.mark.asyncio
    async def test_missing_anchor_key_no_write(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """消息 metadata 无 engineAnchor 键（旧 daemon / driver 回查失败整轮
        无锚）→ 不写不伪造（NULL=入口灰，R-05）；落库行 agent_event.metadata
        中也无该键（新轨行 metadata_ 列本身仍写 agent_event，与锚无关）。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="claude"
        )
        svc = DaemonService(db_session)

        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("no anchor here"), _agent_event_message("me neither")],
        )
        assert result == 2
        assert await _run_engine_anchor(db_session, run_id) is None
        logs = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        for row in logs:
            ev_metadata = (row.metadata_ or {}).get("agent_event", {}).get("metadata")
            assert not (isinstance(ev_metadata, dict) and ev_metadata.get("engineAnchor"))

    @pytest.mark.asyncio
    async def test_duplicate_submit_no_regression(
        self, db_session: AsyncSession, mocked_redis
    ) -> None:
        """重复提交不覆盖：重试补发的旧锚消息被 dedup 拦下（不产生新落库行），
        已写入的轮内最新锚不得回退（「锚取轮内最新」）。"""
        _session_id, lease_id, run_id, token = await _seed_interactive_run(
            db_session, provider="claude"
        )
        svc = DaemonService(db_session)

        # 批次 1：锚 a 落库。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("turn msg 1", engine_anchor="chain-uuid-a", dedup_key="m1")],
        )
        assert await _run_engine_anchor(db_session, run_id) == "chain-uuid-a"
        # 批次 2：锚 b 落库 → 轮内最新为 b。
        await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("turn msg 2", engine_anchor="chain-uuid-b", dedup_key="m2")],
        )
        assert await _run_engine_anchor(db_session, run_id) == "chain-uuid-b"

        # 批次 3：批次 1 的重试补发（同 dedup_key=m1，乱序迟到）→ 全部被
        # 幂等去重拦下，零新行；轮末锚保持 b 不回退。
        result3 = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_agent_event_message("turn msg 1", engine_anchor="chain-uuid-a", dedup_key="m1")],
        )
        assert result3 == 0  # dedup 全拦
        assert await _run_engine_anchor(db_session, run_id) == "chain-uuid-b"
