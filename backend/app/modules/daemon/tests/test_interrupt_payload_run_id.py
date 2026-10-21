"""2026-10-21-daemon-zombie-turn FR-02（backend 侧）：interrupt payload 携带 run_id.

daemon 侧 interrupt() no-op（会话在 store 但无 running 轮）时按 payload 的
run_id 回报收敛该 pending run（打断秒级生效）。本文件钉住发送侧契约：
``interrupt_session`` / ``_send_interrupt_control`` 下发的 SESSION_INTERRUPT
payload 必须含 ``run_id``（dispatch-now 忙时打断共用路径同享）。旧契约（无
run_id）下 daemon 无法定位 run，只能 ack 了事——正是生产会话 49d893ab 十次
打断全部空转的形态之一。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.service import DaemonService


async def _create_user(db: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"zombie-ri-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="zombie-ri",
        status="active",
    )
    db.add(user)
    await db.commit()
    return user.id


async def _create_runtime(db: AsyncSession, user_id: uuid.UUID) -> None:
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime

    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="zombie-host",
        server_url="https://platform.example.com",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(inst)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=inst.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()


def _mock_hub(connected: bool = True) -> MagicMock:
    """MagicMock hub（test_session_service._mock_hub 同款——绕开真实 hub 内部态）。"""
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


class _FakeRedis:
    async def publish(self, channel: str, payload: str) -> int:
        return 1


@pytest.mark.asyncio
async def test_interrupt_payload_carries_run_id(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """主路径：interrupt_session 下发的 payload 带 run_id（= 当前活跃 run）。"""
    import app.modules.daemon.session.service as svc_mod

    monkeypatch.setattr(svc_mod, "get_redis", lambda: _FakeRedis())
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(uid, provider="claude", prompt="first")

        hub.send_session_control.reset_mock()
        result = await svc.interrupt_session(created.agent_session.id, uid)

    assert result.current_run_id == created.agent_run.id
    assert hub.send_session_control.await_count == 1
    call = hub.send_session_control.await_args
    payload = call.args[2]
    assert payload["run_id"] == str(created.agent_run.id)
    assert payload["session_id"] == str(created.agent_session.id)
    assert payload["lease_id"] == str(created.agent_session.lease_id)
