"""2026-08-29-daemon-platform-resilience task-04：下发编排接入+补拉/ACK 端点+心跳计数+GC 联动（design A2 / D-005@v1 / D-006@v1 / D-007@v1）.

覆盖面（任务卡 acceptance 对应）：

- ``enqueue_and_push`` 下发状态机：WS 推送失败/不在线/异常 → 保持 pending 不丢；
  成功 → delivered（payload 注入 command_id、消息 type 与六类 kind 映射正确，
  permission_response 走专用信封）；
- GET ``/runtimes/{id}/pending-controls``：仅回 pending（delivered 不重发——
  D-006 零重复执行铁律）、created_at 升序、owner-only 404；
- POST ``/runtimes/{id}/controls/ack``：pending|delivered → acked、终态幂等、
  翻转范围限定本 runtime（防越权 ack）；
- 心跳响应 ``pending_controls``：该 daemon 全部 runtime 的 pending 计数一次
  聚合（delivered 不计）；
- GC inject 过期联动（D-007@v1 两条过期路径）：pending 过期与 delivered-未-ack
  过期均把对应 pending run 标 failed（error_code=interactive_inject_send_failed）
  且重复 GC 轮幂等；非 inject kind 不联动；
- permission_response / provider_config_changed 接入路径（fake ws_hub 注入）：
  经真实调用点（respond_permission / notify_provider_switch）落库 + 推送 +
  delivered 标记，离线时保持 pending。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.control_commands import (
    DELIVERED_ACK_GRACE_SECONDS,
    INJECT_SEND_FAILED_ERROR_CODE,
    KIND_PERMISSION_RESPONSE,
    KIND_PROVIDER_CONFIG_CHANGED,
    KIND_SESSION_END,
    KIND_SESSION_INJECT,
    ControlCommandService,
)
from app.modules.daemon.model import (
    DaemonControlCommand,
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)

# ── helpers（镜像 test_control_commands / test_lease_expiry_sweeper 造数范式）──


async def _make_user(db: AsyncSession, *, name: str = "cc-dispatch") -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=name,
        status="active",
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    daemon_instance_id: uuid.UUID | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    await db.refresh(rt)
    return rt


async def _make_instance(db: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:8]}",
        server_url="https://platform.example.com",
    )
    db.add(inst)
    await db.commit()
    await db.refresh(inst)
    return inst


async def _make_run(db: AsyncSession, *, status: str = "pending") -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        spec_strategy="interactive",
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


async def _insert_command(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    kind: str = KIND_SESSION_INJECT,
    status: str = "pending",
    payload: dict[str, Any] | None = None,
    created_at: datetime | None = None,
    delivered_at: datetime | None = None,
    ack_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> DaemonControlCommand:
    """直接落一行指定状态的指令（端点/GC 用例需要精确时钟与状态）。

    ``command_id`` 预生成并注入 payload（对齐 ``enqueue_and_push`` 落库形状：
    补拉/ACK 的 daemon 幂等键就在 payload 里）。
    """
    command_id = uuid.uuid4()
    row = DaemonControlCommand(
        id=command_id,
        runtime_id=runtime_id,
        kind=kind,
        payload={**(payload if payload is not None else {"x": 1}), "command_id": str(command_id)},
        status=status,
        created_at=created_at or datetime.now(UTC),
        delivered_at=delivered_at,
        ack_at=ack_at,
        expires_at=expires_at,
    )
    db.add(row)
    # 不 refresh（对齐 test_control_commands._insert_row）：aiosqlite 会把 aware
    # datetime 存成 naive，refresh 回填 naive 值会让后续 bulk UPDATE 的
    # post-synchronize Python 侧比较（aware 阈值 vs naive 内存值）抛 TypeError；
    # 不 refresh 时 identity map 保留构造时的 aware 值，比较成立。
    await db.commit()
    return row


async def _fetch_command(db: AsyncSession, command_id: uuid.UUID) -> DaemonControlCommand | None:
    # bulk update 不经 identity map；populate_existing 强制刷新（同 test_control_commands）。
    stmt = (
        select(DaemonControlCommand)
        .where(DaemonControlCommand.id == command_id)
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalars().first()


async def _fetch_run(db: AsyncSession, run_id: uuid.UUID) -> AgentRun | None:
    stmt = select(AgentRun).where(AgentRun.id == run_id).execution_options(populate_existing=True)
    return (await db.execute(stmt)).scalars().first()


def _payload_of(row: DaemonControlCommand) -> dict[str, Any]:
    """payload 非 None 断言取值（mypy 收窄：列类型 dict | None）。"""
    assert row.payload is not None
    return row.payload


class _FakeHub:
    """记录控制消息推送的假 ws_hub（enqueue_and_push 的 hub 注入口）。"""

    def __init__(self, *, send_ok: bool = True, raise_error: bool = False) -> None:
        self.send_ok = send_ok
        self.raise_error = raise_error
        self.session_calls: list[tuple[uuid.UUID, str, dict[str, Any]]] = []
        self.permission_calls: list[tuple[uuid.UUID, dict[str, Any]]] = []

    async def send_session_control(
        self, daemon_id: uuid.UUID, msg_type: str, payload: dict[str, Any]
    ) -> bool:
        self.session_calls.append((daemon_id, msg_type, payload))
        if self.raise_error:
            raise RuntimeError("send boom")
        return self.send_ok

    async def send_permission_response(self, daemon_id: uuid.UUID, payload: dict[str, Any]) -> bool:
        self.permission_calls.append((daemon_id, payload))
        if self.raise_error:
            raise RuntimeError("send boom")
        return self.send_ok


async def _admin_user(db_session: AsyncSession) -> User:
    """auth_headers 背后的平台管理员行（owner 校验用 runtime.user_id == user.id）。"""
    user = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .one()
    )
    return user


# ── enqueue_and_push 下发状态机 ────────────────────────────────────────────────


class TestEnqueueAndPush:
    async def test_ws_fail_keeps_pending(self, db_session: AsyncSession) -> None:
        """WS 推送失败/不在线 → 指令保持 pending 待补拉（不丢，D-006）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        fake = _FakeHub(send_ok=False)

        row, delivered = await ControlCommandService(db_session).enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"session_id": "s1", "prompt": "你好"},
            hub=fake,
        )

        assert delivered is False
        persisted = await _fetch_command(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "pending"
        assert persisted.delivered_at is None
        # 补拉可见：fetch_pending 返回该行（payload 已带 command_id 幂等键）。
        pending_rows = await ControlCommandService(db_session).fetch_pending(rt.id)
        assert [r.id for r in pending_rows] == [row.id]
        assert _payload_of(pending_rows[0])["command_id"] == str(row.id)

    async def test_ws_success_marks_delivered(self, db_session: AsyncSession) -> None:
        """WS 推送成功 → delivered；补拉不再返回（delivered 一律不重发）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        fake = _FakeHub(send_ok=True)

        row, delivered = await ControlCommandService(db_session).enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_SESSION_END,
            payload={"session_id": "s1", "lease_id": "l1"},
            hub=fake,
        )

        assert delivered is True
        persisted = await _fetch_command(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "delivered"
        assert persisted.delivered_at is not None
        assert await ControlCommandService(db_session).fetch_pending(rt.id) == []
        # 消息形状：type 按 kind 映射；payload 尾部注入 command_id，原键原样。
        daemon_id, msg_type, sent_payload = fake.session_calls[0]
        assert daemon_id == rt.id
        assert msg_type == "daemon:session_end"
        assert sent_payload["session_id"] == "s1"
        assert sent_payload["lease_id"] == "l1"
        assert sent_payload["command_id"] == str(row.id)
        assert list(sent_payload.keys())[-1] == "command_id"

    async def test_push_exception_keeps_pending(self, db_session: AsyncSession) -> None:
        """推送异常（罕见路由层错误）与失败同待遇：保持 pending、不抛错。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        fake = _FakeHub(raise_error=True)

        row, delivered = await ControlCommandService(db_session).enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"prompt": "hi"},
            hub=fake,
        )

        assert delivered is False
        persisted = await _fetch_command(db_session, row.id)
        assert persisted is not None
        assert persisted.status == "pending"

    async def test_permission_response_uses_dedicated_envelope(
        self, db_session: AsyncSession
    ) -> None:
        """permission_response 走 send_permission_response 专用信封（非 session_control）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        fake = _FakeHub(send_ok=True)

        row, delivered = await ControlCommandService(db_session).enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_PERMISSION_RESPONSE,
            payload={"request_id": "req-1", "decision": "allow"},
            hub=fake,
        )

        assert delivered is True
        assert fake.session_calls == []  # 不走 session_control
        daemon_id, sent_payload = fake.permission_calls[0]
        assert daemon_id == rt.id
        assert sent_payload["request_id"] == "req-1"
        assert sent_payload["command_id"] == str(row.id)
        persisted = await _fetch_command(db_session, row.id)
        assert persisted is not None
        assert persisted.kind == KIND_PERMISSION_RESPONSE
        assert persisted.status == "delivered"


# ── GET /runtimes/{id}/pending-controls ───────────────────────────────────────


class TestPendingControlsEndpoint:
    async def test_only_pending_returned_ascending(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """补拉仅回 pending（delivered/acked/expired 不重发——D-006），created_at 升序。"""
        admin = await _admin_user(db_session)
        rt = await _make_runtime(db_session, admin.id)
        now = datetime.now(UTC)
        oldest = await _insert_command(
            db_session,
            rt.id,
            payload={"prompt": "first"},
            created_at=now - timedelta(seconds=30),
        )
        await _insert_command(
            db_session, rt.id, status="delivered", delivered_at=now, payload={"prompt": "d"}
        )
        await _insert_command(
            db_session, rt.id, status="acked", ack_at=now, payload={"prompt": "a"}
        )
        await _insert_command(db_session, rt.id, status="expired", payload={"prompt": "e"})
        newest = await _insert_command(
            db_session,
            rt.id,
            payload={"prompt": "second"},
            created_at=now - timedelta(seconds=10),
        )

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-controls", headers=auth_headers
        )

        assert resp.status_code == 200
        body = resp.json()
        assert [c["id"] for c in body["commands"]] == [str(oldest.id), str(newest.id)]
        first = body["commands"][0]
        assert first["kind"] == "session_inject"
        assert first["payload"]["prompt"] == "first"
        assert first["payload"]["command_id"] == str(oldest.id)
        assert first["created_at"] is not None

    async def test_owner_mismatch_returns_404(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """跨用户/不存在同语义 404（owner-only，对齐 pending-leases 惯例）。"""
        other = await _make_user(db_session, name="not-admin")
        rt = await _make_runtime(db_session, other.id)

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-controls", headers=auth_headers
        )

        assert resp.status_code == 404

    async def test_missing_auth_rejected(self, client: AsyncClient) -> None:
        resp = await client.get(f"/api/daemon/runtimes/{uuid.uuid4()}/pending-controls")
        assert resp.status_code in (401, 403)


# ── POST /runtimes/{id}/controls/ack ──────────────────────────────────────────


class TestAckEndpoint:
    async def test_ack_pending_and_delivered_then_idempotent(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """pending 与 delivered 均可 ack；重复 ack 终态幂等（acked=0）。"""
        admin = await _admin_user(db_session)
        rt = await _make_runtime(db_session, admin.id)
        now = datetime.now(UTC)
        pending = await _insert_command(db_session, rt.id)
        delivered = await _insert_command(db_session, rt.id, status="delivered", delivered_at=now)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/controls/ack",
            json={"ids": [str(pending.id), str(delivered.id)]},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == {"acked": 2}
        for cid in (pending.id, delivered.id):
            row = await _fetch_command(db_session, cid)
            assert row is not None
            assert row.status == "acked"
            assert row.ack_at is not None

        # 重复 ack：已终态跳过，幂等。
        resp2 = await client.post(
            f"/api/daemon/runtimes/{rt.id}/controls/ack",
            json={"ids": [str(pending.id), str(delivered.id)]},
            headers=auth_headers,
        )
        assert resp2.status_code == 200
        assert resp2.json() == {"acked": 0}

    async def test_ack_scoped_to_runtime(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """翻转范围限定本 runtime：他人 runtime 名下的指令 id 不被越权 ack。"""
        admin = await _admin_user(db_session)
        rt_mine = await _make_runtime(db_session, admin.id)
        other = await _make_user(db_session, name="foreign")
        rt_other = await _make_runtime(db_session, other.id)
        foreign = await _insert_command(db_session, rt_other.id)
        mine = await _insert_command(db_session, rt_mine.id)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt_mine.id}/controls/ack",
            json={"ids": [str(foreign.id), str(mine.id)]},
            headers=auth_headers,
        )

        assert resp.status_code == 200
        assert resp.json() == {"acked": 1}
        foreign_row = await _fetch_command(db_session, foreign.id)
        assert foreign_row is not None
        assert foreign_row.status == "pending"

    async def test_ack_empty_ids_returns_zero(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        admin = await _admin_user(db_session)
        rt = await _make_runtime(db_session, admin.id)

        resp = await client.post(
            f"/api/daemon/runtimes/{rt.id}/controls/ack",
            json={"ids": []},
            headers=auth_headers,
        )

        assert resp.status_code == 200
        assert resp.json() == {"acked": 0}


# ── 心跳 pending_controls 计数 ────────────────────────────────────────────────


class TestHeartbeatPendingControls:
    async def test_heartbeat_counts_pending_across_runtimes(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """心跳响应 pending_controls = 该 daemon 全部 runtime 的 pending 行数
        （一次聚合，delivered/acked 不计；服务层直调计数一致）。"""
        from app.modules.daemon.runtime.service import RuntimeService

        admin = await _admin_user(db_session)
        inst = await _make_instance(db_session, admin.id)
        rt_a = await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)
        rt_b = await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)
        # rt_a 1 pending + 1 delivered；rt_b 1 pending；另一 daemon 的行不计数。
        await _insert_command(db_session, rt_a.id)
        await _insert_command(
            db_session, rt_a.id, status="delivered", delivered_at=datetime.now(UTC)
        )
        await _insert_command(db_session, rt_b.id)
        other_inst = await _make_instance(db_session, admin.id)
        rt_other = await _make_runtime(db_session, admin.id, daemon_instance_id=other_inst.id)
        await _insert_command(db_session, rt_other.id)

        resp = await client.post(
            "/api/daemon/heartbeat",
            json={"daemon_local_id": str(inst.id), "providers": []},
            headers=auth_headers,
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["daemon_instance_id"] == str(inst.id)
        assert body["pending_controls"] == 2
        # 服务层直调同一聚合（task 指定 runtime/service.py 落点）。
        assert await RuntimeService(db_session).count_pending_control_commands(inst.id) == 2

    async def test_heartbeat_zero_when_no_pending(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        admin = await _admin_user(db_session)
        inst = await _make_instance(db_session, admin.id)
        await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)

        resp = await client.post(
            "/api/daemon/heartbeat",
            json={"daemon_local_id": str(inst.id), "providers": []},
            headers=auth_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["pending_controls"] == 0


# ── GC inject 过期联动（D-007@v1 两条过期路径）────────────────────────────────


class TestGcInjectRunLinkage:
    async def test_pending_expiry_fails_run_idempotent(self, db_session: AsyncSession) -> None:
        """inject pending 过期 → 对应 run failed（error_code 沿用先例）；
        重复 GC 轮幂等（第二轮 runs_failed=0、run 不重复写）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="pending")
        now = datetime.now(UTC)
        await _insert_command(
            db_session,
            rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"run_id": str(run.id), "prompt": "hi"},
            expires_at=now - timedelta(minutes=1),
        )

        svc = ControlCommandService(db_session)
        first = await svc.gc(now)
        second = await svc.gc(now + timedelta(seconds=1))

        assert first.runs_failed == 1
        assert second.runs_failed == 0  # 幂等：条件 UPDATE 第二轮 0 命中
        run_row = await _fetch_run(db_session, run.id)
        assert run_row is not None
        assert run_row.status == "failed"
        assert run_row.error_code == INJECT_SEND_FAILED_ERROR_CODE
        assert run_row.finished_at is not None

    async def test_delivered_unacked_expiry_fails_run(self, db_session: AsyncSession) -> None:
        """inject delivered-未-ack 超 10min → expired + run failed（X-15 两条
        过期路径语义一致，不留 600s sweep 兜底）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="running")
        now = datetime.now(UTC)
        cmd = await _insert_command(
            db_session,
            rt.id,
            kind=KIND_SESSION_INJECT,
            status="delivered",
            payload={"run_id": str(run.id)},
            delivered_at=now - timedelta(seconds=DELIVERED_ACK_GRACE_SECONDS + 60),
        )

        result = await ControlCommandService(db_session).gc(now)

        assert result.expired == 1
        assert result.runs_failed == 1
        cmd_row = await _fetch_command(db_session, cmd.id)
        assert cmd_row is not None
        assert cmd_row.status == "expired"
        run_row = await _fetch_run(db_session, run.id)
        assert run_row is not None
        assert run_row.status == "failed"
        assert run_row.error_code == INJECT_SEND_FAILED_ERROR_CODE

    async def test_non_inject_expiry_does_not_touch_runs(self, db_session: AsyncSession) -> None:
        """非 inject kind（permission_response / session_end 等）过期不联动 run。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="pending")
        now = datetime.now(UTC)
        await _insert_command(
            db_session,
            rt.id,
            kind=KIND_PERMISSION_RESPONSE,
            payload={"run_id": str(run.id), "decision": "deny"},
            expires_at=now - timedelta(minutes=1),
        )

        result = await ControlCommandService(db_session).gc(now)

        assert result.expired == 1
        assert result.runs_failed == 0
        run_row = await _fetch_run(db_session, run.id)
        assert run_row is not None
        assert run_row.status == "pending"

    async def test_terminal_run_not_relinked(self, db_session: AsyncSession) -> None:
        """run 已终态（completed/failed）→ 联动条件 UPDATE 不命中，runs_failed=0
        （下发点 dispatch 失败先标 failed 的行与 GC 路径互不重复写）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="failed")
        now = datetime.now(UTC)
        await _insert_command(
            db_session,
            rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"run_id": str(run.id)},
            expires_at=now - timedelta(minutes=1),
        )

        result = await ControlCommandService(db_session).gc(now)

        assert result.runs_failed == 0
        run_row = await _fetch_run(db_session, run.id)
        assert run_row is not None
        assert run_row.status == "failed"
        assert run_row.error_code is None


# ── permission_response 接入路径（真实调用点 + fake ws_hub 注入）──────────────


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    """对齐 test_session_permissions 的 SSE 发布隔离（get_redis 指向 fake）。"""
    redis = _mock_redis()
    with (
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


class TestPermissionResponseDispatch:
    async def test_respond_permission_enqueues_and_delivers(
        self, db_session: AsyncSession, mocked_redis: AsyncMock
    ) -> None:
        """用户审批（plain canUseTool）经控制指令通道：落库 pending → 推送 →
        delivered；WS payload 带 command_id，消息形状其余字段不变。"""
        from app.modules.daemon.permission_service import DaemonPermissionService
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.service import DaemonService

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=user.id,
            provider="claude",
            status="active",
            config={"manual_approval": True, "model": "claude"},
            turn_count=1,
            runtime_id=rt.id,
            lease_id=uuid.uuid4(),
            created_at=datetime.now(UTC),
        )
        db_session.add(sess)
        await db_session.flush()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=sess.id,
        )
        db_session.add(run)
        await db_session.commit()

        fake = _FakeHub(send_ok=True)
        perm = DaemonPermissionService(DaemonService(db_session), fake, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id,
            PermissionRequestPayload(
                session_id=sess.id,
                run_id=run.id,
                request_id="req-1",
                tool_name="Bash",
                input={"command": "ls"},
            ),
        )

        result = await perm.respond_permission(
            user_id=user.id,
            session_id=sess.id,
            request_id="req-1",
            decision="allow",
        )

        assert result.accepted is True
        # fake hub 收到专用信封推送（含 command_id）。
        assert len(fake.permission_calls) == 1
        daemon_id, sent_payload = fake.permission_calls[0]
        assert daemon_id == rt.id
        assert sent_payload["decision"] == "allow"
        assert sent_payload["request_id"] == "req-1"
        command_id = sent_payload["command_id"]
        # 落库行：kind=permission_response、delivered、payload 同构。
        row = await _fetch_command(db_session, uuid.UUID(command_id))
        assert row is not None
        assert row.kind == KIND_PERMISSION_RESPONSE
        assert row.status == "delivered"
        assert row.runtime_id == rt.id
        assert _payload_of(row)["decision"] == "allow"
        # timer 已清（既有语义零回归）。
        assert "req-1" not in perm._timers

    async def test_respond_permission_offline_keeps_pending(
        self, db_session: AsyncSession, mocked_redis: AsyncMock
    ) -> None:
        """审批时 daemon 不在线 → 504 语义保持，但指令已落库 pending 待补拉
        （re-arm timer 语义不变）。"""
        from app.modules.daemon.permission_service import DaemonPermissionService
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline
        from app.modules.daemon.service import DaemonService

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=user.id,
            provider="claude",
            status="active",
            config={"manual_approval": True, "model": "claude"},
            turn_count=1,
            runtime_id=rt.id,
            lease_id=uuid.uuid4(),
            created_at=datetime.now(UTC),
        )
        db_session.add(sess)
        await db_session.flush()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="running",
            spec_strategy="interactive",
            agent_session_id=sess.id,
        )
        db_session.add(run)
        await db_session.commit()

        fake = _FakeHub(send_ok=False)
        perm = DaemonPermissionService(DaemonService(db_session), fake, timeout_sec=30.0)
        await perm.handle_permission_request(
            rt.id,
            PermissionRequestPayload(
                session_id=sess.id,
                run_id=run.id,
                request_id="req-2",
                tool_name="Bash",
                input={"command": "ls"},
            ),
        )

        with pytest.raises(DaemonRuntimeOffline):
            await perm.respond_permission(
                user_id=user.id,
                session_id=sess.id,
                request_id="req-2",
                decision="allow",
            )

        # 指令保持 pending（断线窗口审批结果不丢，重连补拉送达）+ timer re-arm。
        pending = await ControlCommandService(db_session).fetch_pending(rt.id)
        assert len(pending) == 1
        assert pending[0].kind == KIND_PERMISSION_RESPONSE
        assert _payload_of(pending[0])["request_id"] == "req-2"
        assert "req-2" in perm._timers
        # 清理 re-arm 的 timer（防泄漏到其它测试）。
        task = perm._timers.pop("req-2")
        task.cancel()
        try:
            await task
        except Exception:  # cancel 后收尾，CancelledError 均吞
            pass


# ── provider_config_changed 接入路径（notify_provider_switch 真实调用点）──────


def _patch_ws_hub(monkeypatch: pytest.MonkeyPatch, fake: _FakeHub) -> None:
    """把 ws_hub.get_ws_hub 单例访问器指向 fake（control_commands 调用时 import）。"""
    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: fake)


async def _make_interactive_session(
    db: AsyncSession, user_id: uuid.UUID, runtime_id: uuid.UUID
) -> None:
    """active 会话 + interactive lease（notify_provider_switch 的命中形状）。"""
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="pending",
        metadata_={"claim_token": "tok"},
    )
    db.add(lease)
    await db.flush()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=lease.id,
        created_at=datetime.now(UTC),
    )
    db.add(sess)
    await db.commit()


class TestProviderConfigChangedDispatch:
    async def test_notify_provider_switch_enqueues_and_delivers(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """供应商热切换经控制指令通道：kind=provider_config_changed 落库 +
        推送成功 delivered，payload 原 provider_config 透传 + command_id 注入。"""
        from app.modules.daemon.lease.provider_switch import notify_provider_switch

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        await _make_interactive_session(db_session, user.id, rt.id)
        fake = _FakeHub(send_ok=True)
        _patch_ws_hub(monkeypatch, fake)
        provider_config = {"base_url": "https://api.example.com", "api_key": "sk-x"}

        delivered_count = await notify_provider_switch(db_session, user.id, provider_config)

        assert delivered_count == 1
        daemon_id, msg_type, sent_payload = fake.session_calls[0]
        assert daemon_id == rt.id  # 未绑 instance 的迁移期回退路由键
        assert msg_type == "daemon:provider_config_changed"
        assert sent_payload["provider_config"] == provider_config
        rows = await ControlCommandService(db_session).fetch_pending(rt.id)
        assert rows == []  # 已 delivered，补拉不重发
        cmd = (
            (
                await db_session.execute(
                    select(DaemonControlCommand).where(DaemonControlCommand.runtime_id == rt.id)
                )
            )
            .scalars()
            .one()
        )
        assert cmd.kind == KIND_PROVIDER_CONFIG_CHANGED
        assert cmd.status == "delivered"
        assert _payload_of(cmd)["command_id"] == str(cmd.id)

    async def test_notify_provider_switch_offline_keeps_pending(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """daemon 离线 → 投递计数 0（既有返回语义），指令落库 pending 待补拉。"""
        from app.modules.daemon.lease.provider_switch import notify_provider_switch

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        await _make_interactive_session(db_session, user.id, rt.id)
        fake = _FakeHub(send_ok=False)
        _patch_ws_hub(monkeypatch, fake)

        delivered_count = await notify_provider_switch(db_session, user.id, None)

        assert delivered_count == 0
        pending = await ControlCommandService(db_session).fetch_pending(rt.id)
        assert len(pending) == 1
        assert pending[0].kind == KIND_PROVIDER_CONFIG_CHANGED
        assert _payload_of(pending[0])["provider_config"] is None
        assert _payload_of(pending[0])["command_id"] == str(pending[0].id)


# ── 派发失败收链 _row 未绑定回归（ql-20260904 审计 H1）─────────────────────────
#
# de664fb69 给 not control_ok 分支加 _cancel_pending_control_command(_row.id) 时，
# _row 仅在非切换分支的 enqueue_and_push 赋值——切换轮 hub 直推失败与 runtime
# 解析失败（daemon_id=None）两条路径引用未绑定名抛 UnboundLocalError：500 替代
# 504、run 收敛代码不执行 → run 永久残留 running。两例分别坐实两条路径恢复
# 「DaemonRuntimeOffline + run→failed(interactive_inject_send_failed)」语义。


async def _make_injectable_session(
    db: AsyncSession, user_id: uuid.UUID, runtime_id: uuid.UUID
) -> AgentSession:
    """active 会话 + interactive lease（inject_session 可注入形状），返回会话行。"""
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status="pending",
        metadata_={"claim_token": "tok"},
    )
    db.add(lease)
    await db.flush()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=lease.id,
        created_at=datetime.now(UTC),
    )
    db.add(sess)
    await db.commit()
    return sess


class TestInjectDispatchFailureConvergence:
    async def test_switch_turn_hub_send_fail_converges(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        mocked_redis: AsyncMock,
    ) -> None:
        """切换轮（model 重置）hub 直推失败 → 504 收敛，run→failed，不抛
        UnboundLocalError（原实现该路径 _row 未绑定）。"""
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline
        from app.modules.daemon.session.service import SessionService

        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        sess = await _make_injectable_session(db_session, user.id, rt.id)
        # 跳过 readiness 8s 等待（测试无 daemon /ready 上报）。
        from app.modules.daemon.session.service import get_session_readiness

        get_session_readiness().mark_ready(sess.id)
        fake = _FakeHub(send_ok=False)
        _patch_ws_hub(monkeypatch, fake)

        with pytest.raises(DaemonRuntimeOffline):
            await SessionService(db_session).inject_session(
                sess.id, user.id, prompt="你好", model=""
            )

        # 切换分支走 hub 直推（无控制指令行落库），推送确实尝试过。
        assert [c[1] for c in fake.session_calls] == ["daemon:session_switch_config"]
        # run 收敛 failed + 既有错误码（而非残留 running）。
        run = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .one()
        )
        assert run.status == "failed"
        assert run.error_code == INJECT_SEND_FAILED_ERROR_CODE
        assert run.output_redacted is not None
        # 切换分支无指令行 → 无 pending 残留可补拉。
        assert await ControlCommandService(db_session).fetch_pending(rt.id) == []

    async def test_runtime_missing_converges(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        mocked_redis: AsyncMock,
    ) -> None:
        """runtime 行缺失（daemon_id 解析 None）→ 504 收敛，run→failed，不抛
        UnboundLocalError（原实现该路径 _row 未绑定）。"""
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline
        from app.modules.daemon.session.service import SessionService, get_session_readiness

        user = await _make_user(db_session)
        # 会话指向不存在的 runtime 行（runtime_id 非空但查无行）。
        sess = await _make_injectable_session(db_session, user.id, uuid.uuid4())
        get_session_readiness().mark_ready(sess.id)
        fake = _FakeHub(send_ok=False)
        _patch_ws_hub(monkeypatch, fake)

        with pytest.raises(DaemonRuntimeOffline):
            await SessionService(db_session).inject_session(sess.id, user.id, prompt="你好")

        assert fake.session_calls == []  # 未到 hub 推送（runtime 解析即失败）
        run = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .one()
        )
        assert run.status == "failed"
        assert run.error_code == INJECT_SEND_FAILED_ERROR_CODE
        assert run.output_redacted is not None
