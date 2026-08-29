"""task-03（2026-08-29-daemon-platform-resilience / design A4）：lease 过期 GC 单拍单测.

只直调 ``*_once`` 单拍函数（注入 AsyncSession + fake ws_hub），不真等 60s 常驻
循环（constraints：显式控制时钟与事件循环；常驻循环的协程手法与既有
session_reconnect_sweeper 逐字一致，由 lifespan 挂载先例覆盖）。覆盖：

- ``lease_expiry_sweep_once``：
  - claimed batch lease 心跳停（``lease_expires_at`` 过期）→ expired + attempt<3
    重派（run 翻 pending + started_at 清空 + 新 pending lease attempt+1 + 新
    lease 的 WS 唤醒已发出——fake hub 按既有语义以 runtime_id 为路由键收到）；
  - attempt≥3 → run failed（exit_code=-1 + finished_at），不建新 lease；
  - pending lease（``lease_expires_at`` 恒 NULL）不受影响；
  - 卡死 terminating lease（D-007 方案 C）仅告警不改 status。
- ``wake_pending_leases_for_online_daemons_once``（lifespan 重启恢复）：
  - 在线 daemon（DB status=online）的 pending batch lease 收到 wakeup（按
    daemon_instance_id 路由 + payload_runtime_id 指明 runtime）；
  - 离线 daemon 的 lease / interactive lease（agent_run_id NULL）不唤醒；
  - 重唤醒幂等：重复调用无 DB 副作用（lease/run 原样、不新增行）；
  - daemon_instance_id 为空的迁移期 runtime 行跳过不炸。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.sweep import (
    lease_expiry_sweep_once,
    wake_pending_leases_for_online_daemons_once,
)

# ── Helpers（镜像 test_kill_and_state_mapping / test_session_reconnect_sweep 造数范式）──


async def _make_user(db: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"lease-sweep-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name="lease-sweep",
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_instance(db: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:8]}",
        server_url="https://platform.example.com",
    )
    db.add(inst)
    await db.commit()
    return inst


async def _make_runtime(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
    daemon_instance_id: uuid.UUID | None = None,
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


async def _make_run(db: AsyncSession, *, status: str = "running") -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        # 显式给非 None 起跑时间，验证重派路径确实清空（而非默认值碰巧为 None）。
        started_at=datetime.now(UTC) if status == "running" else None,
    )
    db.add(run)
    await db.commit()
    return run


async def _make_lease(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    agent_run_id: uuid.UUID | None,
    kind: str = "batch",
    status: str = "claimed",
    attempt: int = 1,
    expires_in_past: bool = False,
    terminating_at: datetime | None = None,
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        kind=kind,
        status=status,
        claimed_at=now if status == "claimed" else None,
        # pending batch lease 派发时 lease_expires_at 恒 NULL（placement.py 注释：
        # expire_leases 永不选中它）——claimed 后才由心跳写入续期窗口。
        lease_expires_at=now - timedelta(seconds=30) if expires_in_past else None,
        attempt_number=attempt,
        terminating_at=terminating_at,
        metadata_={"claim_token": f"tok-{uuid.uuid4().hex[:12]}"},
    )
    db.add(lease)
    await db.commit()
    return lease


class _FakeWsHub:
    """记录 send_wakeup 调用的假 hub（替换 ws_hub.get_ws_hub 单例访问器）.

    placement._send_ws_wakeup / ws_hub.send_wakeup 只用到下面四个成员，
    形状与之对齐即可（send_wakeup 兼容 str/UUID 入参，统一 str 化记录便于断言）。
    """

    def __init__(self, *connected: uuid.UUID) -> None:
        self.connected: set[uuid.UUID] = set(connected)
        self.calls: list[dict[str, str | None]] = []

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        return daemon_id in self.connected

    @property
    def connected_runtime_ids(self) -> list[uuid.UUID]:
        return list(self.connected)

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


def _patch_ws_hub(monkeypatch: pytest.MonkeyPatch, fake: _FakeWsHub) -> None:
    """把 ws_hub.get_ws_hub 指向 fake（_send_ws_wakeup 调用时才 import，patch 模块属性即生效）."""
    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_ws_hub", lambda: fake)


async def _lease_status(db: AsyncSession, lease_id: uuid.UUID) -> str | None:
    return (
        await db.execute(select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease_id))
    ).scalar_one()


async def _run_row(db: AsyncSession, run_id: uuid.UUID) -> Any:
    return (
        await db.execute(
            select(
                AgentRun.status,
                AgentRun.started_at,
                AgentRun.finished_at,
                AgentRun.exit_code,
            ).where(AgentRun.id == run_id)
        )
    ).one()


# ── lease_expiry_sweep_once ─────────────────────────────────────────────────


class TestLeaseExpirySweep:
    async def test_expired_claimed_attempt1_rolls_back_and_requeues(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """claimed lease 心跳停 + attempt=1 → 旧 lease expired、run 翻 pending
        （started_at 清空）、新 pending lease attempt=2，且新 lease 的 WS 唤醒
        已发出（既有 handle_lease_expiry 语义：按 runtime_id 路由）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="running")
        lease = await _make_lease(
            db_session,
            rt.id,
            agent_run_id=run.id,
            status="claimed",
            attempt=1,
            expires_in_past=True,
        )
        # 既有回滚路径 _send_ws_wakeup(runtime_id, ...) 的路由键是 runtime_id。
        fake = _FakeWsHub(rt.id)
        _patch_ws_hub(monkeypatch, fake)

        processed = await lease_expiry_sweep_once(db_session)

        assert processed == 1
        assert await _lease_status(db_session, lease.id) == "expired"
        row = await _run_row(db_session, run.id)
        assert row.status == "pending"
        assert row.started_at is None  # 重派路径显式清空
        # 新 pending lease：attempt+1、同 runtime、绑同一 run。
        new_lease = (
            (
                await db_session.execute(
                    select(DaemonTaskLease).where(
                        DaemonTaskLease.agent_run_id == run.id,
                        DaemonTaskLease.status == "pending",
                    )
                )
            )
            .scalars()
            .one()
        )
        assert new_lease.attempt_number == 2
        assert new_lease.runtime_id == rt.id
        # 新 lease 的唤醒已发（唤醒是新 pending lease 被 daemon claim 的触发信号）。
        wakeup_leases = [c["lease_id"] for c in fake.calls]
        assert str(new_lease.id) in wakeup_leases

    async def test_expired_claimed_attempt3_fails_run(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """attempt=3（≥3）→ run failed（exit_code=-1 + finished_at + 提示文案），
        不再新建 pending lease（max retries 到顶，终态收敛）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="running")
        lease = await _make_lease(
            db_session,
            rt.id,
            agent_run_id=run.id,
            status="claimed",
            attempt=3,
            expires_in_past=True,
        )
        _patch_ws_hub(monkeypatch, _FakeWsHub())  # 全断连：failed 路径不发唤醒

        processed = await lease_expiry_sweep_once(db_session)

        assert processed == 1
        assert await _lease_status(db_session, lease.id) == "expired"
        row = await _run_row(db_session, run.id)
        assert row.status == "failed"
        assert row.finished_at is not None
        assert row.exit_code == -1
        # 不建新 lease：该 run 名下仍只有原 expired 一行。
        lease_count = (
            await db_session.execute(
                select(DaemonTaskLease.id).where(DaemonTaskLease.agent_run_id == run.id)
            )
        ).all()
        assert len(lease_count) == 1

    async def test_pending_lease_without_expiry_untouched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """pending batch lease（lease_expires_at=NULL）不被 GC 碰：状态原样、
        run 原样、无新 lease（expire_leases 的 NULL 过期时间短路语义）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="pending")
        lease = await _make_lease(
            db_session,
            rt.id,
            agent_run_id=run.id,
            status="pending",
            expires_in_past=False,
        )
        _patch_ws_hub(monkeypatch, _FakeWsHub())

        processed = await lease_expiry_sweep_once(db_session)

        assert processed == 0
        assert await _lease_status(db_session, lease.id) == "pending"
        row = await _run_row(db_session, run.id)
        assert row.status == "pending"
        lease_count = (
            await db_session.execute(
                select(DaemonTaskLease.id).where(DaemonTaskLease.agent_run_id == run.id)
            )
        ).all()
        assert len(lease_count) == 1

    async def test_stuck_terminating_lease_alerted_not_mutated(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """卡死 terminating lease（cancel 后超 30s 无 daemon 回传）：sweeper 顺带
        告警但不改 status（D-007 方案 C：仅观测，cancelled 原样）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id)
        run = await _make_run(db_session, status="running")
        lease = await _make_lease(
            db_session,
            rt.id,
            agent_run_id=run.id,
            status="cancelled",
            terminating_at=datetime.now(UTC) - timedelta(seconds=60),
        )
        _patch_ws_hub(monkeypatch, _FakeWsHub())

        processed = await lease_expiry_sweep_once(db_session)

        # cancelled lease 不在 expire_leases 的 claimed/pending 选取范围 → 0 处理；
        # alert_stuck_terminating_leases 只记日志，不动 DB。
        assert processed == 0
        assert await _lease_status(db_session, lease.id) == "cancelled"
        row = await _run_row(db_session, run.id)
        assert row.status == "running"


# ── wake_pending_leases_for_online_daemons_once（lifespan 重启恢复）──────────


class TestStartupWakeup:
    async def test_online_daemon_pending_batch_lease_woken_only(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """只有「在线 daemon 的 pending batch lease」收到唤醒：按
        daemon_instance_id 路由 + payload_runtime_id 指明 runtime；离线
        daemon 的 lease 与 interactive lease 不发。"""
        user = await _make_user(db_session)
        inst_on = await _make_instance(db_session, user.id)
        inst_off = await _make_instance(db_session, user.id)
        rt_on = await _make_runtime(
            db_session, user.id, status="online", daemon_instance_id=inst_on.id
        )
        rt_off = await _make_runtime(
            db_session, user.id, status="offline", daemon_instance_id=inst_off.id
        )
        run_on = await _make_run(db_session, status="pending")
        run_off = await _make_run(db_session, status="pending")
        lease_on = await _make_lease(db_session, rt_on.id, agent_run_id=run_on.id, status="pending")
        lease_off = await _make_lease(
            db_session, rt_off.id, agent_run_id=run_off.id, status="pending"
        )
        # interactive lease：绑 session 不绑 run（agent_run_id NULL），不在唤醒范围。
        lease_interactive = await _make_lease(
            db_session, rt_on.id, agent_run_id=None, kind="interactive", status="pending"
        )
        fake = _FakeWsHub(inst_on.id)
        _patch_ws_hub(monkeypatch, fake)

        woken = await wake_pending_leases_for_online_daemons_once(db_session)

        assert woken == 1
        assert fake.calls == [
            {
                "daemon_id": str(inst_on.id),
                "lease_id": str(lease_on.id),
                "payload_runtime_id": str(rt_on.id),
            }
        ]
        woken_ids = {c["lease_id"] for c in fake.calls}
        assert str(lease_off.id) not in woken_ids
        assert str(lease_interactive.id) not in woken_ids

    async def test_repeat_wakeup_idempotent_no_db_side_effect(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """幂等（acceptance「重复重启不产生重复副作用」）：重复调用只是重发
        触发信号——lease 仍 pending、run 仍 pending、不新增 lease 行，DB 零变化。"""
        user = await _make_user(db_session)
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, status="online", daemon_instance_id=inst.id)
        run = await _make_run(db_session, status="pending")
        lease = await _make_lease(db_session, rt.id, agent_run_id=run.id, status="pending")
        fake = _FakeWsHub(inst.id)
        _patch_ws_hub(monkeypatch, fake)

        first = await wake_pending_leases_for_online_daemons_once(db_session)
        second = await wake_pending_leases_for_online_daemons_once(db_session)

        assert first == 1
        assert second == 1  # 信号重发（daemon claim 幂等 + ws_hub 去重滑窗兜底）
        assert await _lease_status(db_session, lease.id) == "pending"
        row = await _run_row(db_session, run.id)
        assert row.status == "pending"
        lease_count = (
            await db_session.execute(
                select(DaemonTaskLease.id).where(DaemonTaskLease.agent_run_id == run.id)
            )
        ).all()
        assert len(lease_count) == 1

    async def test_runtime_without_instance_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """迁移期 runtime 行（daemon_instance_id=NULL，无 WS 路由键）：跳过、
        不炸、不计入 woken（该 lease 交 lease_expiry_sweeper 过期重派路径收敛）。"""
        user = await _make_user(db_session)
        rt = await _make_runtime(db_session, user.id, status="online")
        run = await _make_run(db_session, status="pending")
        lease = await _make_lease(db_session, rt.id, agent_run_id=run.id, status="pending")
        fake = _FakeWsHub()
        _patch_ws_hub(monkeypatch, fake)

        woken = await wake_pending_leases_for_online_daemons_once(db_session)

        assert woken == 0
        assert fake.calls == []
        assert await _lease_status(db_session, lease.id) == "pending"
