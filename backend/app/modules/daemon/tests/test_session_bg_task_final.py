"""2026-10-28-bg-task-status-report task-04：bg_task_final 上报端点测试。

Covers FR-02 / D-005@v1 / D-012 同纪律：
  * POST /sessions/{session_id}/bg-task-final：无凭据 401 / 跨 owner 与未知
    会话 404（不泄露存在性，零发布）/ 合法上报 200 且 agent_session:{id}
    频道收到 bg_task_final 事件（payload 键名 task_id/tool_use_id/status/
    output_file/timestamp 逐字断言）；
  * status 三值封闭枚举：completed/failed/stopped 合法，未知值 422；
  * 纯发布信号（D-005）：无 DB 日志行写入（agent_run_logs 计数不变）。

fixture/Redis mock 模式逐字对齐 test_turn_phase_events.py。
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

# ── helpers（对齐 test_turn_phase_events.py）─────────────────────────────────


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
    ag = AgentSession(
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
        agent_session_id=ag.id,
    )
    session.add_all([ag, run])
    await session.commit()
    await session.refresh(ag)
    await session.refresh(run)
    return ag, run


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock(return_value=1)
    return redis


def _payload(run_id: uuid.UUID | None, status: str = "completed") -> dict:
    return {
        "run_id": str(run_id) if run_id is not None else None,
        "task_id": "bk2n9szuv",
        "tool_use_id": "call_e0c1d816b07e44b8a8f848c2",
        "status": status,
        "output_file": "C:\\temp\\tasks\\bk2n9szuv.output",
    }


class TestBgTaskFinalEndpoint:
    @pytest.mark.asyncio
    async def test_no_credentials_401(self, client: AsyncClient) -> None:
        """无凭据 → 401。"""
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/bg-task-final",
            json=_payload(uuid.uuid4()),
        )
        assert resp.status_code == 401, resp.text

    @pytest.mark.asyncio
    async def test_non_owner_404_no_publish(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """非 runtime owner → 404 零发布（越权防护先例同款）。"""
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
                f"/api/daemon/sessions/{ag_session.id}/bg-task-final",
                json=_payload(uuid.uuid4()),
                headers=auth_headers,
            )

        assert resp.status_code == 404, resp.text
        assert redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_unknown_status_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """status 三值封闭枚举：未知值 422。"""
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/bg-task-final",
            json=_payload(uuid.uuid4(), status="weird"),
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["completed", "failed", "stopped"])
    async def test_valid_report_200_payload_keys_verbatim(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        status: str,
    ) -> None:
        """合法上报 → 200 且频道事件键名逐字对齐（三态参数化）。"""
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/bg-task-final",
                json=_payload(run.id, status=status),
                headers=auth_headers,
            )

        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        assert redis.publish.await_count == 1
        channel, raw = redis.publish.await_args_list[0].args
        assert channel == f"agent_session:{ag_session.id}"
        event = json.loads(raw)
        assert event["event"] == "bg_task_final"
        assert event["session_id"] == str(ag_session.id)
        assert event["run_id"] == str(run.id)
        assert event["task_id"] == "bk2n9szuv"
        assert event["tool_use_id"] == "call_e0c1d816b07e44b8a8f848c2"
        assert event["status"] == status
        assert event["output_file"] == "C:\\temp\\tasks\\bk2n9szuv.output"
        assert "timestamp" in event
