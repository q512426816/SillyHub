"""Tests for plan/bash SSE events and plan-response endpoint (task-10).

Covers FR-01/FR-02/FR-03 / D-001@v1 / D-002@v1:
  * daemon ingestion endpoints publish plan_mode_entered / bash_status / bash_chunk /
    agent_task_status events to ``agent_session:{session_id}`` channel;
  * bash_chunk 100ms throttling + 8KB truncation;
  * plan-response endpoint 200/404/422 behavior;
  * plan-response 200 delivers a ``daemon:plan_response`` WebSocket control message.

Redis is mocked (AsyncMock); no live broker. WS hub is mocked via fresh_ws_hub.
Production code is not modified.
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
from app.modules.daemon.protocol import DAEMON_MSG_PLAN_RESPONSE
from app.modules.daemon.ws_hub import DaemonWsHub

# ── Fixtures ─────────────────────────────────────────────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    hub = DaemonWsHub()
    monkeypatch.setattr("app.modules.daemon.ws_hub._ws_hub", hub)
    return hub


# ── Helpers ──────────────────────────────────────────────────────────────────


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


async def _admin_id(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    admin = (
        (await session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


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


# ── SSE event publishing via daemon ingestion endpoints ───────────────────────


class TestSessionEventPublishing:
    @pytest.mark.asyncio
    async def test_plan_mode_entered_published_to_session_channel(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        session_id = ag_session.id
        run_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{session_id}/plan-mode-entered",
                json={
                    "event": "plan_mode_entered",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "summary": {
                        "objective": "修复登录缺陷",
                        "tasks": ["复现", "定位", "修复"],
                        "design_snippet": "增加空值校验",
                    },
                    "requested_at": "2026-08-24T10:00:00Z",
                },
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{session_id}"
        assert payload["event"] == "plan_mode_entered"
        assert payload["session_id"] == str(session_id)
        assert payload["run_id"] == str(run_id)
        assert payload["summary"]["objective"] == "修复登录缺陷"

    @pytest.mark.asyncio
    async def test_bash_status_published_to_session_channel(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        session_id = ag_session.id
        run_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{session_id}/bash-status",
                json={
                    "event": "bash_status",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "command": "npm test",
                    "status": "running",
                },
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{session_id}"
        assert payload["event"] == "bash_status"
        assert payload["command"] == "npm test"

    @pytest.mark.asyncio
    async def test_bash_chunk_throttling_and_truncation(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        session_id = ag_session.id
        run_id = uuid.uuid4()
        redis = _mock_redis()

        # 8KB + 1 content
        big_content = "x" * (8 * 1024 + 1)

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            # First call publishes immediately.
            resp1 = await client.post(
                f"/api/daemon/sessions/{session_id}/bash-chunk",
                json={
                    "event": "bash_chunk",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "command": "cat log",
                    "channel": "stdout",
                    "content": "first",
                    "is_final": False,
                },
                headers=auth_headers,
            )
            # Second call within 100ms is throttled.
            resp2 = await client.post(
                f"/api/daemon/sessions/{session_id}/bash-chunk",
                json={
                    "event": "bash_chunk",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "command": "cat log",
                    "channel": "stdout",
                    "content": "second",
                    "is_final": False,
                },
                headers=auth_headers,
            )
            # is_final bypasses throttle.
            resp3 = await client.post(
                f"/api/daemon/sessions/{session_id}/bash-chunk",
                json={
                    "event": "bash_chunk",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "command": "cat log",
                    "channel": "stdout",
                    "content": big_content,
                    "is_final": True,
                },
                headers=auth_headers,
            )

        assert resp1.status_code == 200, resp1.text
        assert resp2.status_code == 200, resp2.text
        assert resp3.status_code == 200, resp3.text
        assert resp2.json()["throttled"] is True
        assert resp3.json()["throttled"] is False

        publishes = _decode_publishes(redis)
        # first + is_final; second throttled; is_final truncated to 8KB.
        assert len(publishes) == 2
        assert publishes[0][1]["content"] == "first"
        assert publishes[1][1]["content"] == big_content[: 8 * 1024]

    @pytest.mark.asyncio
    async def test_agent_task_status_published_to_session_channel(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        session_id = ag_session.id
        run_id = uuid.uuid4()
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{session_id}/agent-task-status",
                json={
                    "event": "agent_task_status",
                    "session_id": str(session_id),
                    "run_id": str(run_id),
                    "task_id": "t-1",
                    "task_name": "scan",
                    "status": "running",
                    "progress": 42,
                },
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{session_id}"
        assert payload["event"] == "agent_task_status"
        assert payload["task_id"] == "t-1"
        assert payload["progress"] == 42


# ── daemon 上行端点会话归属校验（2026-08-25 越权注入防护 P1） ────────────────


class TestUplinkOwnershipGuard:
    """非 runtime owner 的已认证主体 → 404 且零发布；runtime owner → 200。

    修复前 4 个事件上行端点只做 get_current_principal——任意已认证主体可向
    他人会话的 ``agent_session:{id}`` 频道发布伪造事件。修复后发布前经
    ``SessionService.get_session_for_runtime_owner`` 校验（join daemon_runtimes，
    api-key owner = runtime owner；不匹配 / 不存在一律 404 不泄露存在性）。
    ready 端点同款校验见 test_session_readiness.py。
    """

    async def _seed_foreign_session(self, db_session: AsyncSession) -> AgentSession:
        """建一个属于「他人」（非调用方 admin）的 runtime + 会话。"""
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
        return ag_session

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "suffix,payload_builder",
        [
            (
                "plan-mode-entered",
                lambda sid, rid: {
                    "event": "plan_mode_entered",
                    "session_id": str(sid),
                    "run_id": str(rid),
                    "summary": {"objective": "o", "tasks": [], "design_snippet": "d"},
                    "requested_at": "2026-08-24T10:00:00Z",
                },
            ),
            (
                "bash-status",
                lambda sid, rid: {
                    "event": "bash_status",
                    "session_id": str(sid),
                    "run_id": str(rid),
                    "command": "npm test",
                    "status": "running",
                },
            ),
            (
                "bash-chunk",
                lambda sid, rid: {
                    "event": "bash_chunk",
                    "session_id": str(sid),
                    "run_id": str(rid),
                    "command": "cat log",
                    "channel": "stdout",
                    "content": "x",
                    "is_final": False,
                },
            ),
            (
                "agent-task-status",
                lambda sid, rid: {
                    "event": "agent_task_status",
                    "session_id": str(sid),
                    "run_id": str(rid),
                    "task_id": "t-1",
                    "task_name": "scan",
                    "status": "running",
                    "progress": 42,
                },
            ),
        ],
    )
    async def test_non_owner_gets_404_and_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        suffix: str,
        payload_builder,
    ) -> None:
        """admin（非 runtime owner）向他人会话上报 → 404，零事件发布。"""
        ag_session = await self._seed_foreign_session(db_session)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/{suffix}",
                json=payload_builder(ag_session.id, uuid.uuid4()),
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
                f"/api/daemon/sessions/{session_id}/bash-status",
                json={
                    "event": "bash_status",
                    "session_id": str(session_id),
                    "run_id": str(uuid.uuid4()),
                    "command": "npm test",
                    "status": "running",
                },
                headers=auth_headers,
            )

        assert resp.status_code == 404, resp.text
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_runtime_owner_200(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """runtime owner（admin 本人，Bearer JWT）→ 200 且正常发布。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/agent-task-status",
                json={
                    "event": "agent_task_status",
                    "session_id": str(ag_session.id),
                    "run_id": str(uuid.uuid4()),
                    "task_id": "t-1",
                    "task_name": "scan",
                    "status": "running",
                    "progress": 42,
                },
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        assert len(_decode_publishes(redis)) == 1


# ── plan-response endpoint ───────────────────────────────────────────────────


class TestPlanResponseEndpoint:
    @pytest.mark.asyncio
    async def test_plan_response_confirm_200_and_ws_message(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        ws = AsyncMock()
        ws.send_json = AsyncMock()
        ws.close = AsyncMock()
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/plan-response",
            json={
                "session_id": str(ag_session.id),
                "run_id": str(run.id),
                "decision": "confirm",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["ok"] is True
        assert body["delivered"] is True
        ws.send_json.assert_awaited_once()
        msg = ws.send_json.await_args.args[0]
        assert msg["type"] == DAEMON_MSG_PLAN_RESPONSE
        assert msg["payload"]["session_id"] == str(ag_session.id)
        assert msg["payload"]["run_id"] == str(run.id)
        assert msg["payload"]["decision"] == "confirm"
        assert "feedback" in msg["payload"]

    @pytest.mark.asyncio
    async def test_plan_response_revise_200_requires_feedback(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        ws = AsyncMock()
        ws.send_json = AsyncMock()
        ws.close = AsyncMock()
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/plan-response",
            json={
                "session_id": str(ag_session.id),
                "run_id": str(run.id),
                "decision": "revise",
                "feedback": "请补充单元测试",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        msg = ws.send_json.await_args.args[0]
        assert msg["payload"]["decision"] == "revise"
        assert msg["payload"]["feedback"] == "请补充单元测试"

    @pytest.mark.asyncio
    async def test_plan_response_422_missing_feedback_for_revise(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/plan-response",
            json={
                "session_id": str(ag_session.id),
                "run_id": str(run.id),
                "decision": "revise",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_plan_response_422_path_body_session_id_mismatch(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/plan-response",
            json={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "decision": "confirm",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_plan_response_404_unknown_session(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        session_id = uuid.uuid4()
        run_id = uuid.uuid4()

        resp = await client.post(
            f"/api/daemon/sessions/{session_id}/plan-response",
            json={
                "session_id": str(session_id),
                "run_id": str(run_id),
                "decision": "confirm",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_plan_response_404_run_not_in_session(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
        other_run_id = uuid.uuid4()

        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/plan-response",
            json={
                "session_id": str(ag_session.id),
                "run_id": str(other_run_id),
                "decision": "confirm",
            },
            headers=auth_headers,
        )

        assert resp.status_code == 404, resp.text
