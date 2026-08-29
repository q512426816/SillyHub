"""2026-08-29-daemon-platform-resilience task-11：四场景集成回归（design 全局验收标准）.

端到端串联各 task 交付的端点/服务/协程单拍（对齐 task-03/04/05 单测的造数范式，
HTTP 侧走真实 router）。四场景映射（design 设计目标 1-4 / FR-01~07）：

- 场景①（网络波动控制指令零丢失）：``enqueue_and_push`` WS 推送失败保持
  pending → GET ``/runtimes/{id}/pending-controls`` 只回 pending（delivered 一律
  不重发——零重复投递源，同 command_id 不二次执行的后端锁定）→ POST ack 收口
  → 补拉清空，零丢失零重复；
- 场景②（backend 重启收敛）：``wake_pending_leases_for_online_daemons_once``
  重启重唤醒在线 daemon 的 pending batch lease（WS wakeup 按 instance 路由）+
  ``lease_expiry_sweep_once`` 把心跳停的 claimed lease 过期重派（attempt<3
  建 pending lease attempt+1）或 run failed（attempt≥3）；
- 场景③（daemon 重启会话恢复）：suspend-batch 三步收敛（run failed
  (daemon_stopped) + session suspended + lease cancelled）→ 24h 内不被 GC →
  HTTP ``/recover``（suspended → reconnecting + claim_token 轮换）→ HTTP
  ``/confirm-reconnected``（reconnecting → active），历史 logs 全程完整；
- 场景④（心跳计数跨 runtime 聚合）：``POST /heartbeat`` 响应
  ``pending_controls`` 聚合该 daemon 全部 runtime 的 pending 行（delivered 不
  计、他 daemon 不计），ack 后计数实时下降。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.control_commands import (
    KIND_SESSION_INJECT,
    ControlCommandService,
)
from app.modules.daemon.model import (
    DaemonControlCommand,
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)
from app.modules.daemon.session.service import DAEMON_STOPPED_ERROR_CODE

# ── helpers（镜像 test_control_command_dispatch / test_lease_expiry_sweeper /
# test_session_suspend 造数范式，跨场景复用一份）──────────────────────────────


async def _make_user(db: AsyncSession, *, prefix: str = "resil") -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=prefix,
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _admin_user(db: AsyncSession) -> User:
    """auth_headers 背后的平台管理员行（HTTP 端点 owner 校验用）。"""
    return (await db.execute(select(User).where(User.email == "admin@example.com"))).scalars().one()


async def _make_instance(db: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:8]}",
        server_url="https://platform.example.com",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(inst)
    await db.commit()
    return inst


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    daemon_instance_id: uuid.UUID | None = None,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_lease(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    kind: str = "interactive",
    status: str = "claimed",
    claim_token: str = "tok-old",
    agent_run_id: uuid.UUID | None = None,
    attempt: int = 1,
    expires_in_past: bool = False,
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        kind=kind,
        status=status,
        claimed_at=now if status == "claimed" else None,
        # interactive lease 恒 NULL；batch lease claimed 后由心跳写续期窗口
        # （pending 恒 NULL——expire_leases 永不选中，见 test_lease_expiry_sweeper）。
        lease_expires_at=now - timedelta(seconds=30) if expires_in_past else None,
        attempt_number=attempt,
        metadata_={"session_id": "sdk-sess", "claim_token": claim_token},
    )
    db.add(lease)
    await db.commit()
    return lease


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    *,
    status: str,
    lease_id: uuid.UUID | None,
    last_active_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude",
        status=status,
        agent_session_id=f"sdk-{uuid.uuid4().hex[:8]}",
        config={"model": "sonnet"},
        turn_count=1,
        cwd="/workspace/proj",
        created_at=now,
        last_active_at=last_active_at or now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_run(
    db: AsyncSession,
    session_id: uuid.UUID | None,
    *,
    status: str = "running",
) -> AgentRun:
    """造 run：session_id None = 独立 batch run（场景②，不挂 interactive session）。"""
    run = AgentRun(
        agent_type="claude_code",
        status=status,
        agent_session_id=session_id,
        started_at=datetime.now(UTC) if status in ("running", "completed") else None,
    )
    db.add(run)
    await db.commit()
    return run


async def _make_log(db: AsyncSession, run_id: uuid.UUID, *, seq: int) -> AgentRunLog:
    log = AgentRunLog(
        run_id=run_id,
        channel="stdout",
        content_redacted=f"历史消息 {seq}",
        timestamp=datetime.now(UTC) - timedelta(minutes=5 - seq),
    )
    db.add(log)
    await db.commit()
    return log


async def _insert_command(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    kind: str = KIND_SESSION_INJECT,
    status: str = "pending",
    payload: dict[str, Any] | None = None,
    created_at: datetime | None = None,
) -> DaemonControlCommand:
    """直接落一行指定状态指令（command_id 预注入 payload，对齐 enqueue 落库形状）。"""
    command_id = uuid.uuid4()
    row = DaemonControlCommand(
        id=command_id,
        runtime_id=runtime_id,
        kind=kind,
        payload={**(payload if payload is not None else {"x": 1}), "command_id": str(command_id)},
        status=status,
        created_at=created_at or datetime.now(UTC),
        delivered_at=datetime.now(UTC) if status in ("delivered", "acked") else None,
        ack_at=datetime.now(UTC) if status == "acked" else None,
    )
    db.add(row)
    # 不 refresh（对齐 test_control_command_dispatch._insert_command 的 aiosqlite
    # naive/aware datetime 注释）。
    await db.commit()
    return row


async def _fetch_command(db: AsyncSession, command_id: uuid.UUID) -> DaemonControlCommand | None:
    stmt = (
        select(DaemonControlCommand)
        .where(DaemonControlCommand.id == command_id)
        .execution_options(populate_existing=True)
    )
    return (await db.execute(stmt)).scalars().first()


class _FakePushHub:
    """记录控制消息推送的假 ws_hub（enqueue_and_push 的 hub 注入口）。"""

    def __init__(self, *, send_ok: bool = True) -> None:
        self.send_ok = send_ok
        self.session_calls: list[tuple[uuid.UUID, str, dict[str, Any]]] = []

    async def send_session_control(
        self, daemon_id: uuid.UUID, msg_type: str, payload: dict[str, Any]
    ) -> bool:
        self.session_calls.append((daemon_id, msg_type, payload))
        return self.send_ok


class _FakeWakeupHub:
    """记录 send_wakeup 的假 ws_hub（形状对齐 test_lease_expiry_sweeper._FakeWsHub）。"""

    def __init__(self, *connected: uuid.UUID) -> None:
        self.connected = set(connected)
        self.calls: list[dict[str, str | None]] = []

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        return daemon_id in self.connected

    async def send_wakeup(
        self,
        daemon_id: uuid.UUID | str,
        task_id: uuid.UUID | str | None = None,
        lease_id: uuid.UUID | str | None = None,
        *,
        payload_runtime_id: uuid.UUID | str | None = None,
    ) -> bool:
        self.calls.append(
            {
                "daemon_id": str(daemon_id),
                "lease_id": str(lease_id) if lease_id is not None else None,
                "payload_runtime_id": (
                    str(payload_runtime_id) if payload_runtime_id is not None else None
                ),
            }
        )
        return True


def _patch_wakeup_hub(monkeypatch: pytest.MonkeyPatch, fake: _FakeWakeupHub) -> None:
    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_ws_hub", lambda: fake)


@pytest.fixture()
def mocked_redis() -> Iterator[AsyncMock]:
    """对齐 test_session_suspend 的 SSE 发布隔离（get_redis 指向 fake）。"""
    from unittest.mock import patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


# ── 场景①：控制指令断线补拉（零丢失 / 零重复投递源）──────────────────────────


class TestScenario1ControlCommandPullRepull:
    async def test_offline_enqueue_pull_ack_zero_loss_zero_dup(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """断线窗口全链：WS 推送失败保持 pending → 补拉只回 pending（delivered
        不重发 = 同 command_id 不二次执行的后端锁定）→ ack → 补拉清空。"""
        admin = await _admin_user(db_session)
        rt = await _make_runtime(db_session, admin.id)
        svc = ControlCommandService(db_session)

        # daemon 不在线：WS 推送失败，指令保持 pending（零丢失）。
        offline_cmd, delivered = await svc.enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"session_id": "s1", "prompt": "你好"},
            hub=_FakePushHub(send_ok=False),
        )
        assert delivered is False
        # 对照行：WS 推送成功 → delivered（daemon 已收到，不进补拉）。
        online_cmd, online_delivered = await svc.enqueue_and_push(
            daemon_id=rt.id,
            runtime_id=rt.id,
            kind=KIND_SESSION_INJECT,
            payload={"session_id": "s1", "prompt": "第二条"},
            hub=_FakePushHub(send_ok=True),
        )
        assert online_delivered is True

        # daemon 重连补拉：只回 offline 那条（payload 带 command_id 幂等键）。
        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-controls", headers=auth_headers
        )
        assert resp.status_code == 200
        commands = resp.json()["commands"]
        assert [c["id"] for c in commands] == [str(offline_cmd.id)]
        assert commands[0]["payload"]["command_id"] == str(offline_cmd.id)

        # 消费成功 → ack（pending|delivered 均可 ack）；零丢失收口。
        resp_ack = await client.post(
            f"/api/daemon/runtimes/{rt.id}/controls/ack",
            json={"ids": [str(offline_cmd.id)]},
            headers=auth_headers,
        )
        assert resp_ack.status_code == 200
        assert resp_ack.json() == {"acked": 1}
        assert (await _fetch_command(db_session, offline_cmd.id)).status == "acked"

        # 再次补拉清空：delivered/acked 均不重发（零重复投递源）。
        resp2 = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-controls", headers=auth_headers
        )
        assert resp2.status_code == 200
        assert resp2.json()["commands"] == []
        assert (await _fetch_command(db_session, online_cmd.id)).status == "delivered"

    async def test_pull_returns_only_pending_no_source_of_duplicate(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """同 command_id 不二次执行的后端锁定：四种状态同行落库，补拉永远只回
        pending 行——WS 已 delivered 的指令不存在任何重发通道。"""
        admin = await _admin_user(db_session)
        rt = await _make_runtime(db_session, admin.id)
        now = datetime.now(UTC)
        pending = await _insert_command(db_session, rt.id, status="pending", created_at=now)
        await _insert_command(db_session, rt.id, status="delivered")
        await _insert_command(db_session, rt.id, status="acked")
        await _insert_command(db_session, rt.id, status="expired")

        resp = await client.get(
            f"/api/daemon/runtimes/{rt.id}/pending-controls", headers=auth_headers
        )

        assert resp.status_code == 200
        assert [c["id"] for c in resp.json()["commands"]] == [str(pending.id)]


# ── 场景②：backend 重启收敛（重唤醒 + lease 过期重派/failed）─────────────────


class TestScenario2BackendRestartConvergence:
    async def test_restart_wakes_online_daemon_pending_leases(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """lifespan 启动重唤醒：在线 daemon 的 pending batch lease 收到 wakeup
        （按 daemon_instance_id 路由 + payload_runtime_id 指明 runtime）。"""
        from app.modules.daemon.sweep import wake_pending_leases_for_online_daemons_once

        user = await _make_user(db_session, prefix="resil-wake")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        run = await _make_run(db_session, None, status="pending")
        lease = await _make_lease(
            db_session,
            rt.id,
            kind="batch",
            status="pending",
            agent_run_id=run.id,
        )
        fake = _FakeWakeupHub(inst.id)
        _patch_wakeup_hub(monkeypatch, fake)

        woken = await wake_pending_leases_for_online_daemons_once(db_session)

        assert woken == 1
        assert fake.calls == [
            {
                "daemon_id": str(inst.id),
                "lease_id": str(lease.id),
                "payload_runtime_id": str(rt.id),
            }
        ]

    async def test_claimed_lease_heartbeat_stop_requeues_then_fails(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """claimed lease 心跳停（lease_expires_at 过期）→ lease_expiry_sweep_once：
        attempt=1 过期重派（新 pending lease attempt=2 + 唤醒）；attempt=3 到顶
        run failed（exit_code=-1）不建新 lease。"""
        from app.modules.daemon.sweep import lease_expiry_sweep_once

        user = await _make_user(db_session, prefix="resil-exp")
        rt = await _make_runtime(db_session, user.id)
        run_requeue = await _make_run(db_session, None, status="running")
        run_top = await _make_run(db_session, None, status="running")

        lease1 = await _make_lease(
            db_session,
            rt.id,
            kind="batch",
            status="claimed",
            agent_run_id=run_requeue.id,
            attempt=1,
            expires_in_past=True,
        )
        lease3 = await _make_lease(
            db_session,
            rt.id,
            kind="batch",
            status="claimed",
            agent_run_id=run_top.id,
            attempt=3,
            expires_in_past=True,
        )
        fake = _FakeWakeupHub(rt.id)
        _patch_wakeup_hub(monkeypatch, fake)

        processed = await lease_expiry_sweep_once(db_session)

        assert processed == 2
        # attempt=1 → 重派：旧 lease expired、run 翻 pending、新 pending lease attempt=2。
        assert (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease1.id)
            )
        ).scalar_one() == "expired"
        row_requeue = (
            await db_session.execute(select(AgentRun.status).where(AgentRun.id == run_requeue.id))
        ).scalar_one()
        assert row_requeue == "pending"
        new_lease = (
            (
                await db_session.execute(
                    select(DaemonTaskLease).where(
                        DaemonTaskLease.agent_run_id == run_requeue.id,
                        DaemonTaskLease.status == "pending",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert new_lease.attempt_number == 2
        assert str(new_lease.id) in {c["lease_id"] for c in fake.calls}
        # attempt=3 → 终态：run failed、不建新 lease。
        assert (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease3.id)
            )
        ).scalar_one() == "expired"
        row_top = (
            await db_session.execute(
                select(AgentRun.status, AgentRun.exit_code, AgentRun.finished_at).where(
                    AgentRun.id == run_top.id
                )
            )
        ).one()
        assert row_top.status == "failed"
        assert row_top.exit_code == -1
        assert row_top.finished_at is not None
        top_leases = (
            await db_session.execute(
                select(DaemonTaskLease.id).where(DaemonTaskLease.agent_run_id == run_top.id)
            )
        ).all()
        assert len(top_leases) == 1  # 只有原 expired 行，无重派新 lease


# ── 场景③：daemon 重启会话恢复（suspend→recover→confirm 全链）────────────────


class TestScenario3DaemonRestartRecovery:
    async def test_suspend_recover_confirm_full_chain_with_logs_intact(
        self,
        client: AsyncClient,
        db_session: AsyncSession,
        auth_headers: dict,
        mocked_redis: AsyncMock,
    ) -> None:
        """daemon 优雅停止挂起 → 24h 内不被 GC → 重启 recover（suspended →
        reconnecting + token 轮换）→ confirm（→ active）；历史 logs 全程完整。"""
        from app.modules.daemon import sweep as sweep_mod

        admin = await _admin_user(db_session)
        inst = await _make_instance(db_session, admin.id)
        rt = await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="claimed", claim_token="tok-old")
        sess = await _make_session(db_session, admin.id, rt.id, status="active", lease_id=lease.id)
        # 历史：一条已完成 run（2 条日志）+ 当前中断中 run（1 条日志）。
        prior_run = await _make_run(db_session, sess.id, status="completed")
        await _make_log(db_session, prior_run.id, seq=1)
        await _make_log(db_session, prior_run.id, seq=2)
        current_run = await _make_run(db_session, sess.id, status="running")
        current_log = await _make_log(db_session, current_run.id, seq=3)
        log_ids = set(
            (await db_session.execute(select(AgentRunLog.id).order_by(AgentRunLog.timestamp)))
            .scalars()
            .all()
        )

        # 1. daemon stop → suspend-batch：三步收敛（run failed(daemon_stopped) +
        #    session suspended + lease cancelled）。
        resp = await client.post(
            "/api/daemon/sessions/suspend-batch",
            json={"daemon_local_id": str(inst.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"suspended": 1, "runs_failed": 1}
        sess_status = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert sess_status == "suspended"
        run_row = (
            await db_session.execute(
                select(AgentRun.status, AgentRun.error_code).where(AgentRun.id == current_run.id)
            )
        ).one()
        assert run_row == ("failed", DAEMON_STOPPED_ERROR_CODE)
        assert (
            await db_session.execute(
                select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease.id)
            )
        ).scalar_one() == "cancelled"

        # 2. 24h 内不被 GC（suspended 新鲜，sweep 单拍 0 收敛）。
        converged = await sweep_mod.session_offline_sweep_once(db_session)
        assert converged == 0
        assert (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one() == "suspended"

        # 3. daemon 重启 _recoverSessionsOnBoot → HTTP recover：suspended →
        #    reconnecting + claim_token 轮换（cancelled lease 仍可 recover）。
        resp_recover = await client.post(
            f"/api/daemon/sessions/{sess.id}/recover",
            json={
                "runtime_id": str(rt.id),
                "lease_id": str(lease.id),
                "provider": "claude",
                "agent_session_id": sess.agent_session_id or "sdk-1",
                "interrupted_run_id": str(current_run.id),
            },
            headers=auth_headers,
        )
        assert resp_recover.status_code == 200, resp_recover.text
        assert resp_recover.json()["status"] == "reconnecting"
        db_session.expunge_all()
        lease_row = await db_session.get(DaemonTaskLease, lease.id)
        assert lease_row is not None
        new_token = (lease_row.metadata_ or {}).get("claim_token")
        assert new_token is not None and new_token != "tok-old"

        # 4. restoreAndReconnect 成功 → HTTP confirm-reconnected：→ active。
        resp_confirm = await client.post(
            f"/api/daemon/sessions/{sess.id}/confirm-reconnected",
            json={"runtime_id": str(rt.id), "lease_id": str(lease.id)},
            headers=auth_headers,
        )
        assert resp_confirm.status_code == 200, resp_confirm.text
        assert resp_confirm.json()["status"] == "active"

        # 5. 历史完整：DB 行数与 id 集不变（挂起/恢复不碰日志）。
        after_ids = set(
            (await db_session.execute(select(AgentRunLog.id).order_by(AgentRunLog.timestamp)))
            .scalars()
            .all()
        )
        assert after_ids == log_ids

        # 6. 前端读回完整：HTTP logs 端点返回全部历史（含中断轮日志）。
        resp_logs = await client.get(f"/api/daemon/sessions/{sess.id}/logs", headers=auth_headers)
        assert resp_logs.status_code == 200
        entries = resp_logs.json()
        assert len(entries) == 3
        contents = [e["content_redacted"] for e in entries]
        assert current_log.content_redacted in contents

        # 7. 会话已 active，可继续对话（状态链闭环：suspended → reconnecting → active）。
        final_status = (
            await db_session.execute(select(AgentSession.status).where(AgentSession.id == sess.id))
        ).scalar_one()
        assert final_status == "active"


# ── 场景④：心跳 pending_controls 跨 runtime 聚合 ──────────────────────────────


class TestScenario4HeartbeatPendingControlsCount:
    async def test_heartbeat_aggregates_across_runtimes_and_tracks_ack(
        self, client: AsyncClient, db_session: AsyncSession, auth_headers: dict
    ) -> None:
        """心跳计数聚合：同 daemon 两 runtime 的 pending 合计（delivered/acked
        不计、他 daemon 不计）；ack 后下一次心跳计数实时下降。"""
        admin = await _admin_user(db_session)
        inst = await _make_instance(db_session, admin.id)
        rt_a = await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)
        rt_b = await _make_runtime(db_session, admin.id, daemon_instance_id=inst.id)
        # rt_a：1 pending + 1 delivered；rt_b：2 pending。
        a_pending = await _insert_command(db_session, rt_a.id)
        await _insert_command(db_session, rt_a.id, status="delivered")
        b_pending_1 = await _insert_command(db_session, rt_b.id)
        b_pending_2 = await _insert_command(db_session, rt_b.id)
        # 他 daemon 的 pending 不计数。
        other_inst = await _make_instance(db_session, admin.id)
        rt_other = await _make_runtime(db_session, admin.id, daemon_instance_id=other_inst.id)
        await _insert_command(db_session, rt_other.id)

        async def _heartbeat() -> int:
            resp = await client.post(
                "/api/daemon/heartbeat",
                json={"daemon_local_id": str(inst.id), "providers": []},
                headers=auth_headers,
            )
            assert resp.status_code == 200
            return int(resp.json()["pending_controls"])

        assert await _heartbeat() == 3  # rt_a 1 + rt_b 2（跨 runtime 聚合正确）

        # 消费 rt_b 两条 → 计数下降到 1（只余 rt_a pending）。
        resp_ack = await client.post(
            f"/api/daemon/runtimes/{rt_b.id}/controls/ack",
            json={"ids": [str(b_pending_1.id), str(b_pending_2.id)]},
            headers=auth_headers,
        )
        assert resp_ack.status_code == 200
        assert resp_ack.json() == {"acked": 2}

        assert await _heartbeat() == 1
        assert (await _fetch_command(db_session, a_pending.id)).status == "pending"
