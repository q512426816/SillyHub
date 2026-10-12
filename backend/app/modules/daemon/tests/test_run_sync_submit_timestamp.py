"""submit_messages wire 事件时间戳落库单测（2026-10-12-session-defects task-01 / FR-02）。

覆盖 _event_timestamp 解析与 submit_messages 落库/SSE 双路一致性：

1. N≥3 条携带互异 ISO timestamp 的消息 → agent_run_logs 各行 timestamp 与
   对应消息一致（不再整批共享 st.now 单值——生产会话 47e2ff1a 同毫秒 8~31 行
   聚集实证的根因修复）；
2. 无 timestamp 字段（旧版 daemon）→ 行 timestamp=st.now，行为与现状逐字节
   一致（向后兼容零回归）；
3. 钟差 >5 分钟的伪造时戳 → 回落 st.now（daemon 时钟漂移防污染）；
4. SSE published_logs 的 timestamp 与对应落库行一致（实时流与 DB 时间线同源）。

harness 镜像 test_subagent_log_attribution.py 的最小单 run+lease 构造。
"""

from __future__ import annotations

import secrets
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService

# submit_messages 的 Redis publish 在 router commit 后执行（publish 意图延迟），
# 单测沿用 run_sync 系测试的 redis mock 夹具口径（防意外触网）。
from .test_run_sync_assistant_override import mocked_redis  # noqa: F401


async def _seed_one_run(db_session: AsyncSession) -> tuple[uuid.UUID, str, uuid.UUID]:
    """建 user/runtime/session/run + lease（submit_messages 校验 lease+token）。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"ts-{uid}@example.com",
            password_hash="x",
            display_name="TS",
            status="active",
        )
    )
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=session_id,
            user_id=uid,
            provider="claude",
            status="active",
            config={},
            turn_count=0,
            runtime_id=rt.id,
            created_at=datetime.now(UTC),
            last_active_at=datetime.now(UTC),
        )
    )
    db_session.add(
        AgentRun(
            id=run_id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=session_id,
        )
    )
    token = secrets.token_hex(32)
    lease_id = uuid.uuid4()
    db_session.add(
        DaemonTaskLease(
            id=lease_id,
            runtime_id=rt.id,
            agent_run_id=run_id,
            kind="batch",
            status="pending",
            lease_expires_at=None,
            metadata_={"claim_token": token},
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return lease_id, token, run_id


def _ts_msg(text: str, ts: str | None) -> dict:
    msg = {"event_type": "text", "content": text, "channel": "stdout"}
    if ts is not None:
        msg["timestamp"] = ts
    return msg


async def _fetch_rows(db_session: AsyncSession, run_id: uuid.UUID) -> list[AgentRunLog]:
    rows = (
        (
            await db_session.execute(
                select(AgentRunLog)
                .where(AgentRunLog.run_id == run_id)
                .order_by(AgentRunLog.timestamp.asc())
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


class TestSubmitMessageTimestamps:
    @pytest.mark.asyncio
    async def test_distinct_wire_timestamps_land_per_row(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """N≥3 条互异 timestamp：各落库行 timestamp 与消息一致，不再整批同值。"""
        lease_id, token, run_id = await _seed_one_run(db_session)
        svc = DaemonService(db_session)
        base = datetime.now(UTC) - timedelta(minutes=3)
        stamps = [
            (base + timedelta(seconds=i)).isoformat().replace("+00:00", "+00:00") for i in range(3)
        ]
        result = await svc.submit_messages(
            lease_id,
            token,
            run_id,
            [_ts_msg(f"msg-{i}", stamps[i]) for i in range(3)],
        )
        assert result == 3
        rows = await _fetch_rows(db_session, run_id)
        assert len(rows) == 3
        row_ts = [r.timestamp.replace(tzinfo=UTC) for r in rows]
        expect = [datetime.fromisoformat(s) for s in stamps]
        for got, want in zip(row_ts, expect, strict=True):
            assert got == want, "行时间戳应等于消息携带的事件时刻"
        # 互异性：不再整批共享单值（塌缩回归守卫）。
        assert len({t.isoformat() for t in row_ts}) == 3

    @pytest.mark.asyncio
    async def test_missing_timestamp_falls_back_to_batch_now(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """旧版 daemon（无 timestamp 字段）→ 行 timestamp=st.now，零回归。"""
        lease_id, token, run_id = await _seed_one_run(db_session)
        svc = DaemonService(db_session)
        before = datetime.now(UTC)
        result = await svc.submit_messages(
            lease_id, token, run_id, [_ts_msg("legacy-1", None), _ts_msg("legacy-2", None)]
        )
        assert result == 2
        rows = await _fetch_rows(db_session, run_id)
        assert len(rows) == 2
        after = datetime.now(UTC)
        for r in rows:
            ts = r.timestamp.replace(tzinfo=UTC)
            assert before - timedelta(seconds=5) <= ts <= after + timedelta(seconds=5)

    @pytest.mark.asyncio
    async def test_skewed_timestamp_falls_back(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """钟差 6 分钟的伪造时戳 → 回落 st.now（5 分钟容忍带外）。"""
        lease_id, token, run_id = await _seed_one_run(db_session)
        svc = DaemonService(db_session)
        skewed = (datetime.now(UTC) - timedelta(minutes=6)).isoformat()
        before = datetime.now(UTC)
        result = await svc.submit_messages(lease_id, token, run_id, [_ts_msg("skewed", skewed)])
        assert result == 1
        rows = await _fetch_rows(db_session, run_id)
        ts = rows[0].timestamp.replace(tzinfo=UTC)
        after = datetime.now(UTC)
        assert before - timedelta(seconds=5) <= ts <= after + timedelta(seconds=5)

    @pytest.mark.asyncio
    async def test_sse_payload_timestamp_matches_row(
        self,
        db_session,
        mocked_redis,  # noqa: F811
    ) -> None:
        """SSE published_logs timestamp 与对应落库行一致（实时流与 DB 同源）。"""
        lease_id, token, run_id = await _seed_one_run(db_session)
        svc = DaemonService(db_session)
        stamp = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
        result = await svc.submit_messages(lease_id, token, run_id, [_ts_msg("sse", stamp)])
        rows = await _fetch_rows(db_session, run_id)
        assert result == 1 and len(rows) == 1
        published = result.published_logs
        assert len(published) == 1
        want = rows[0].timestamp.replace(tzinfo=UTC)
        got = datetime.fromisoformat(published[0]["timestamp"].replace("Z", "+00:00"))
        assert got == want
