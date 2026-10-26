"""2026-10-26-session-stage-progress task-01：turn_phase 协议与发布全集测试。

Covers FR-01/FR-06 / D-011@v1 / D-012@v1 / D-009@v1:
  * 上报端点 POST /sessions/{session_id}/turn-phase：无凭据 401 / 跨 owner 与
    未知会话 404（不泄露存在性）/ 合法上报 200 且 agent_session:{id} 频道收到
    turn_phase 事件（payload 键名 phase/detail/timestamp 逐字断言，D-012）；
  * phase 枚举封闭：7 个上报值合法，dispatched/delivered（backend 自产）422；
  * 控制指令状态机翻转点发布：enqueue_and_push 下发成功点发布 dispatched
    （push 成功与待补拉两路径都发）、ack 回执点发布 delivered（D-011——非
    mark_delivered 的 WS push 成功点，负向断言）；
  * D-009 吞噬：Redis 抛异常时端点/状态机/ack 全部照常，不抛出。

Redis mock（AsyncMock）模式对齐 test_session_plan_bash_events.py；hub 用
AsyncMock fake（send_session_control 返回可控 bool）。
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
from app.modules.daemon.control_commands import ControlCommandService
from app.modules.daemon.model import DaemonControlCommand, DaemonRuntime
from app.modules.daemon.schema import TurnPhaseReportRequest

# ── Fixtures / helpers（对齐 test_session_plan_bash_events.py 模式）──────────


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


def _turn_phase_payload(session_id: uuid.UUID, run_id: uuid.UUID) -> dict:
    return {"run_id": str(run_id), "phase": "skills_sync", "detail": "step 1/5"}


# ── ① 上报端点 ───────────────────────────────────────────────────────────────


class TestTurnPhaseEndpoint:
    @pytest.mark.asyncio
    async def test_no_credentials_401(self, client: AsyncClient) -> None:
        """无凭据 → 401（daemon X-API-Key / Bearer 均未带）。"""
        session_id = uuid.uuid4()
        resp = await client.post(
            f"/api/daemon/sessions/{session_id}/turn-phase",
            json=_turn_phase_payload(session_id, uuid.uuid4()),
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
                email=f"foreign-{other_id}@example.com",
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
                f"/api/daemon/sessions/{ag_session.id}/turn-phase",
                json=_turn_phase_payload(ag_session.id, uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_unknown_session_404_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """会话不存在 → 404（与跨 owner 同码，不泄露存在性），零发布。"""
        session_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{session_id}/turn-phase",
                json=_turn_phase_payload(session_id, uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 404, resp.text
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_valid_report_200_and_payload_keys_verbatim(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """runtime owner 合法上报 → 200 且频道收到 turn_phase，键名逐字（D-012）。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        run_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-phase",
                json=_turn_phase_payload(ag_session.id, run_id),
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{ag_session.id}"
        # D-012 逐字断言：SSE 载荷键恰为 event/session_id/run_id/phase/detail/
        # timestamp——phase/detail/timestamp 三键与前端信封逐字对齐。
        assert set(payload.keys()) == {
            "event",
            "session_id",
            "run_id",
            "phase",
            "detail",
            "timestamp",
        }
        assert payload["event"] == "turn_phase"
        assert payload["phase"] == "skills_sync"
        assert payload["detail"] == "step 1/5"
        assert payload["run_id"] == str(run_id)
        assert payload["session_id"] == str(ag_session.id)
        assert payload["timestamp"]  # ISO 8601 非空

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "phase",
        [
            "skills_sync",
            "spec_sync",
            "mcp_prefetch",
            "spawning",
            "ready",
            "inject_received",
            "first_event",
        ],
    )
    async def test_all_seven_report_phases_accepted(
        self,
        phase: str,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """7 个上报值全部合法（词表封闭枚举正向覆盖）。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-phase",
                json={"run_id": str(uuid.uuid4()), "phase": phase},
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert _decode_publishes(redis)[0][1]["phase"] == phase

    @pytest.mark.asyncio
    @pytest.mark.parametrize("phase", ["dispatched", "delivered", "unknown_phase"])
    async def test_backend_owned_and_unknown_phases_rejected(
        self,
        phase: str,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """dispatched/delivered（backend 自产，D-011）与未知值 → 422 不收上报。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-phase",
                json={"run_id": str(uuid.uuid4()), "phase": phase},
                headers=auth_headers,
            )

        assert resp.status_code == 422, resp.text
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_missing_run_id_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """run_id 必填（D-013②）：缺失 → 422。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/turn-phase",
            json={"phase": "ready"},
            headers=auth_headers,
        )

        assert resp.status_code == 422, resp.text


# ── ② 控制指令状态机翻转点发布（D-011）───────────────────────────────────────


class _FakeHub:
    """send_session_control 可控返回的 fake hub（True=推送成功 / False=不在线）。"""

    def __init__(self, delivered: bool) -> None:
        self._delivered = delivered
        self.send_session_control = AsyncMock(return_value=self._delivered)


async def _seed_command_row(
    db_session: AsyncSession,
    *,
    payload: dict | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """建 runtime + 指令归属环境，返回 (runtime_id, user_id)。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"tp-{uid}@example.com",
            password_hash="x",
            display_name="TP",
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
    await db_session.commit()
    return rt.id, uid


class TestControlCommandTurnPhase:
    @pytest.mark.asyncio
    async def test_enqueue_and_push_publishes_dispatched_on_success(
        self, db_session: AsyncSession
    ) -> None:
        """下发编排 push 成功 → dispatched 发布一次（enqueue 成功点）。"""
        runtime_id, _uid = await _seed_command_row(db_session)
        session_id = uuid.uuid4()
        run_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            row, delivered = await ControlCommandService(db_session).enqueue_and_push(
                daemon_id=runtime_id,
                runtime_id=runtime_id,
                kind="session_inject",
                payload={"session_id": str(session_id), "run_id": str(run_id)},
                hub=_FakeHub(delivered=True),
            )

        assert delivered is True
        assert row.status == "delivered"
        phases = [p["phase"] for _ch, p in _decode_publishes(redis)]
        assert phases == ["dispatched"]  # mark_delivered（WS push 成功点）不发——负向

    @pytest.mark.asyncio
    async def test_enqueue_and_push_publishes_dispatched_when_pending_for_pull(
        self, db_session: AsyncSession
    ) -> None:
        """daemon 不在线（待补拉）→ dispatched 照发（pending-for-pull 语义兼容）。"""
        runtime_id, _uid = await _seed_command_row(db_session)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            _row, delivered = await ControlCommandService(db_session).enqueue_and_push(
                daemon_id=runtime_id,
                runtime_id=runtime_id,
                kind="session_inject",
                payload={"session_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())},
                hub=_FakeHub(delivered=False),
            )

        assert delivered is False
        phases = [p["phase"] for _ch, p in _decode_publishes(redis)]
        assert phases == ["dispatched"]

    @pytest.mark.asyncio
    async def test_ack_publishes_delivered_from_payload(self, db_session: AsyncSession) -> None:
        """ack 回执点 → delivered 发布一次（D-011：daemon 真实确认点）。

        直接落一行 pending（payload 带 session_id/run_id，模拟 enqueue 产物），
        ack 后按 payload 反查发布。
        """
        runtime_id, _uid = await _seed_command_row(db_session)
        session_id = uuid.uuid4()
        run_id = uuid.uuid4()
        row = DaemonControlCommand(
            runtime_id=runtime_id,
            kind="session_inject",
            payload={"session_id": str(session_id), "run_id": str(run_id)},
            status="pending",
            created_at=datetime.now(UTC),
            expires_at=datetime.now(UTC).replace(microsecond=0),
        )
        db_session.add(row)
        await db_session.commit()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            flipped = await ControlCommandService(db_session).ack([row.id])

        assert flipped == 1
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{session_id}"
        assert payload["phase"] == "delivered"
        assert payload["run_id"] == str(run_id)

    @pytest.mark.asyncio
    async def test_mark_delivered_alone_publishes_nothing(self, db_session: AsyncSession) -> None:
        """mark_delivered（WS push 成功点）单独调用不发布（D-011 负向断言）。"""
        runtime_id, _uid = await _seed_command_row(db_session)
        row = DaemonControlCommand(
            runtime_id=runtime_id,
            kind="session_inject",
            payload={"session_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())},
            status="pending",
            created_at=datetime.now(UTC),
            expires_at=datetime.now(UTC).replace(microsecond=0),
        )
        db_session.add(row)
        await db_session.commit()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            await ControlCommandService(db_session).mark_delivered([row.id])

        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_payload_without_session_ids_skips_publish(
        self, db_session: AsyncSession
    ) -> None:
        """payload 无 session_id/run_id（permission_response 等形状）→ 跳过不发。"""
        runtime_id, _uid = await _seed_command_row(db_session)
        row = DaemonControlCommand(
            runtime_id=runtime_id,
            kind="session_inject",
            payload={"x": 1},
            status="pending",
            created_at=datetime.now(UTC),
            expires_at=datetime.now(UTC).replace(microsecond=0),
        )
        db_session.add(row)
        await db_session.commit()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            flipped = await ControlCommandService(db_session).ack([row.id])

        assert flipped == 1
        assert redis.publish.await_count == 0


# ── ③ D-009 吞噬断言 ─────────────────────────────────────────────────────────


class TestTurnPhasePublishSwallow:
    @pytest.mark.asyncio
    async def test_redis_failure_does_not_break_dispatch(self, db_session: AsyncSession) -> None:
        """Redis 抛异常 → enqueue_and_push 不抛、指令状态照常落库（D-009）。"""
        runtime_id, _uid = await _seed_command_row(db_session)

        exploding_redis = AsyncMock()
        exploding_redis.publish = AsyncMock(side_effect=ConnectionError("redis down"))

        with patch(
            "app.modules.daemon.run_sync.service.get_redis",
            return_value=exploding_redis,
        ):
            row, delivered = await ControlCommandService(db_session).enqueue_and_push(
                daemon_id=runtime_id,
                runtime_id=runtime_id,
                kind="session_inject",
                payload={"session_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())},
                hub=_FakeHub(delivered=True),
            )

        assert row.status == "delivered"
        assert delivered is True  # 状态机照常流转

    @pytest.mark.asyncio
    async def test_redis_failure_does_not_break_ack(self, db_session: AsyncSession) -> None:
        """Redis 抛异常 → ack 不抛、翻转照常返回（D-009）。"""
        runtime_id, _uid = await _seed_command_row(db_session)
        row = DaemonControlCommand(
            runtime_id=runtime_id,
            kind="session_inject",
            payload={"session_id": str(uuid.uuid4()), "run_id": str(uuid.uuid4())},
            status="pending",
            created_at=datetime.now(UTC),
            expires_at=datetime.now(UTC).replace(microsecond=0),
        )
        db_session.add(row)
        await db_session.commit()

        exploding_redis = AsyncMock()
        exploding_redis.publish = AsyncMock(side_effect=ConnectionError("redis down"))

        with patch(
            "app.modules.daemon.run_sync.service.get_redis",
            return_value=exploding_redis,
        ):
            flipped = await ControlCommandService(db_session).ack([row.id])

        assert flipped == 1

    @pytest.mark.asyncio
    async def test_endpoint_redis_failure_still_200(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """Redis 抛异常 → 端点仍 200 ok（归属校验通过后发布尽力而为）。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)

        exploding_redis = AsyncMock()
        exploding_redis.publish = AsyncMock(side_effect=ConnectionError("redis down"))

        with patch(
            "app.modules.daemon.run_sync.service.get_redis",
            return_value=exploding_redis,
        ):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/turn-phase",
                json=_turn_phase_payload(ag_session.id, uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True


# ── DTO 契约钉子 ─────────────────────────────────────────────────────────────


def test_turn_phase_report_request_shape() -> None:
    """DTO 形状钉子：run_id 必填 / phase 7 值 / detail 可选。"""
    import pydantic

    assert issubclass(TurnPhaseReportRequest, pydantic.BaseModel)
    fields = TurnPhaseReportRequest.model_fields
    assert set(fields.keys()) == {"run_id", "phase", "detail"}
    assert fields["run_id"].is_required()
    assert fields["detail"].default is None
    with pytest.raises(pydantic.ValidationError):
        TurnPhaseReportRequest(run_id=uuid.uuid4(), phase="dispatched")
