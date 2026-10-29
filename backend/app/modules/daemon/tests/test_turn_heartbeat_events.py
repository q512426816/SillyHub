"""2026-10-29-engine-live-perception FR-02：turn_heartbeat 上报端点测试。

Covers FR-02 / D-001@v1 / D-backend-039:
  * 上报端点 POST /sessions/{session_id}/turn-heartbeat：无凭据 401 / 跨 owner
    与未知会话 404（不泄露存在性）/ runtime owner 合法上报 200 且
    agent_session:{id} 频道收到 turn_heartbeat 事件（payload 键名逐字断言，
    D-backend-039 三端对齐）；
  * **不落库**：合法上报后 AgentRunLog 零新增行（瞬态信号，FR-02）；
  * kind/precision/source 枚举封闭：非法值 422；
  * D-009 吞噬：Redis 抛异常时端点照常 200 不抛出。

Redis mock（AsyncMock）模式对齐 test_turn_phase_events.py。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime

# ── Fixtures / helpers（对齐 test_turn_phase_events.py 模式）──────────────────


async def _admin_id(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    admin = (
        (await session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_session_with_run(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
) -> tuple[AgentSession, AgentRun]:
    ag_session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        provider="claude",
        status="active",
    )
    run = AgentRun(
        id=uuid.uuid4(),
        task_id=uuid.uuid4(),
        agent_type="claude_code",
        status="running",
        agent_session_id=ag_session.id,
    )
    session.add_all([ag_session, run])
    await session.commit()
    await session.refresh(ag_session)
    await session.refresh(run)
    return ag_session, run


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


def _decode_publishes(redis: AsyncMock) -> list[tuple[str, dict]]:
    decoded: list[tuple[str, dict]] = []
    for call in redis.publish.await_args_list:
        channel, raw = call.args
        decoded.append((channel, json.loads(raw)))
    return decoded


def _heartbeat_payload(session_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    return {
        "run_id": str(run_id),
        "kind": "generating",
        "precision": "estimated",
        "source": "claude_input_json_delta",
        "est_chars": 4200,
        "est_tokens": 1200,
    }


# ── 上报端点 ─────────────────────────────────────────────────────────────────


class TestTurnHeartbeatEndpoint:
    @pytest.mark.asyncio
    async def test_no_credentials_401(self, client: AsyncClient) -> None:
        """无凭据 → 401。"""
        session_id = uuid.uuid4()
        resp = await client.post(
            f"/api/daemon/sessions/{session_id}/turn-heartbeat",
            json=_heartbeat_payload(session_id, uuid.uuid4()),
        )
        assert resp.status_code == 401, resp.text

    @pytest.mark.asyncio
    async def test_non_owner_404_and_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """admin（非 runtime owner）向他人会话上报 → 404，零发布。"""
        from app.modules.auth.model import User

        other_id = uuid.uuid4()
        db_session.add(
            User(
                id=other_id,
                email=f"foreign-hb-{other_id}@example.com",
                password_hash="x",
                display_name="foreign",
                status="active",
            )
        )
        await db_session.commit()
        rt = await _create_runtime(db_session, other_id)
        ag_session, _run = await _create_session_with_run(db_session, other_id, rt.id)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-heartbeat",
                json=_heartbeat_payload(ag_session.id, uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 404, resp.text
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_valid_report_200_payload_keys_verbatim_and_no_db_row(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """runtime owner 合法上报 → 200、频道键名逐字（D-backend-039）、零落库。"""
        from app.modules.agent.model import AgentRunLog

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        run_id = uuid.uuid4()
        redis = _mock_redis()

        logs_before = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-heartbeat",
                json=_heartbeat_payload(ag_session.id, run_id),
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{ag_session.id}"
        # D-backend-039 逐字断言：SSE 载荷键恰为 event/session_id/run_id/kind/
        # est_chars/est_tokens/precision/source/parent_tool_use_id/timestamp——
        # 与前端信封逐字对齐（daemon hub-client 同键名 snake_case）。
        assert set(payload.keys()) == {
            "event",
            "session_id",
            "run_id",
            "kind",
            "est_chars",
            "est_tokens",
            "precision",
            "source",
            "parent_tool_use_id",
            "timestamp",
        }
        assert payload["event"] == "turn_heartbeat"
        assert payload["kind"] == "generating"
        assert payload["est_chars"] == 4200
        assert payload["est_tokens"] == 1200
        assert payload["precision"] == "estimated"
        assert payload["source"] == "claude_input_json_delta"
        assert payload["run_id"] == str(run_id)
        assert payload["timestamp"]  # ISO 8601 非空

        # 不落库（FR-02）：心跳是瞬态信号，AgentRunLog 零新增。
        await db_session.rollback()  # 清端点请求事务的可能的读挂起
        logs_after = (
            (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run_id)))
            .scalars()
            .all()
        )
        assert len(logs_after) == len(logs_before) == 0

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_field",
        [
            {"kind": "generating_text"},
            {"kind": None},
            {"precision": "maybe"},
            {"source": "unknown_engine"},
        ],
    )
    async def test_enum_closed_422(
        self,
        bad_field: dict,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """kind/precision/source 枚举封闭：非法值 422。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        payload = _heartbeat_payload(ag_session.id, uuid.uuid4())
        payload.update(bad_field)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/turn-heartbeat",
            json=payload,
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_redis_failure_swallowed_200(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """D-009：Redis 抛异常端点照常 200 不抛出（瞬态信号尽力发布）。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()
        redis.publish.side_effect = RuntimeError("redis down")

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-heartbeat",
                json=_heartbeat_payload(ag_session.id, uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
