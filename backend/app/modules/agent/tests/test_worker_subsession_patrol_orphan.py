"""task-12（2026-08-25-team-subsession-governance）：patrol 孤儿子会话扫描补收口单测。

design §5.D 末行 / FR-06 / 生命周期契约表「patrol 孤儿扫描」行：

- 终态 mission（converged_at / cancelled_at 非空）的活跃分身子会话
  （status ∈ pending/active/reconnecting）由**独立查询**（方向与
  ``_active_mission_ids`` 相反）找出，逐个补发 ``SessionService.end_session``
  （reason=mission_terminal_orphan）收口——兜底 task-10 converge 批量收口
  best-effort 部分失败与 cancel 链漏网，实现零孤儿；
- 活跃 mission 的子会话绝不被收口；存量 mission（session_id 查无会话行 /
  无子会话）扫描零命中零行为变化（FR-09）；已终态子会话不重复收口
  （end_session 幂等早退，lease 不被改写、不重发 SESSION_END）；
- best-effort：单个收口异常 log.warning 继续其余；孤儿扫描职责整体抛错
  只记 duty_failed，不阻断同轮其余职责（异常隔离）。

测试隔离策略：monkeypatch ``ws_hub.get_daemon_ws_hub`` 为录音 hub 断言
SESSION_END 下发（同 test_worker_subsession_converge_close 模式）；收口失败
形态用 batch lease 触发 end_session 的 DaemonSessionInvariantViolation
（同 task-10 部分失败用例机制）；终态 mission 查询 limit 用 monkeypatch
收紧 ACTIVE_MISSION_LIMIT 验证（同 test_patrol limit 用例思路）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.agent.patrol as patrol
from app.modules.agent.model import AgentMission, AgentSession
from app.modules.agent.patrol import MissionPatrolService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END
from app.modules.workspace.model import Workspace

# ── 播种 helpers（对齐 test_worker_subsession_converge_close 模式）───────────


async def _seed_tree(
    db: AsyncSession,
    *,
    terminal: str,
    created_at: datetime | None = None,
    terminal_at: datetime | None = None,
) -> tuple[AgentSession, AgentMission, uuid.UUID, DaemonRuntime]:
    """建 user + workspace + 主控根会话 + 会话 mission（created_by=user）+ 在线 runtime。

    ``terminal`` 控制 mission 形态：converged / cancelled（孤儿扫描应命中）/
    active（绝不命中）。``created_at`` 显式控制用于 limit 轮询顺序验证；
    ``terminal_at`` 显式控制终态时间（converged_at / cancelled_at 列值）——
    审计修复 F02 后名单按「最新终态优先」排序，终态时间需可精确播种。
    """
    user_id = uuid.uuid4()
    db.add(
        User(
            id=user_id,
            email=f"tpo-{user_id.hex[:10]}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    ws_id = uuid.uuid4()
    db.add(
        Workspace(
            id=ws_id,
            name=f"ws-{ws_id.hex[:8]}",
            slug=f"ws-{ws_id.hex[:8]}",
            root_path=f"/tmp/{ws_id.hex}",
        )
    )
    root = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
    )
    db.add(root)
    now = datetime.now(UTC)
    terminal_ts = terminal_at if terminal_at is not None else now
    extra: dict = {}
    if terminal == "converged":
        extra["converged_at"] = terminal_ts
    elif terminal == "cancelled":
        extra["cancelled_at"] = terminal_ts
    if created_at is not None:
        extra["created_at"] = created_at
    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        session_id=root.id,
        created_by=user_id,
        **extra,
    )
    db.add(mission)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"rt-{user_id.hex[:6]}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=now,
    )
    db.add(rt)
    await db.commit()
    await db.refresh(mission)
    return root, mission, user_id, rt


async def _seed_worker(
    db: AsyncSession,
    root: AgentSession,
    *,
    owner_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "active",
    lease_kind: str = "interactive",
) -> tuple[AgentSession, DaemonTaskLease]:
    """建分身子会话（parent 挂根、owner=mission 创建者 D-004）+ claimed lease。

    ``lease_kind="batch"`` 制造 end_session 收口失败形态（绑定校验抛
    DaemonSessionInvariantViolation，同 task-10 部分失败用例）。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        agent_run_id=None,
        status="claimed",
        kind=lease_kind,
        claimed_at=now,
        lease_expires_at=None,
        metadata_={"claim_token": "tok", "session_id": "pending"},
        created_at=now,
        updated_at=now,
    )
    db.add(lease)
    worker = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        provider="claude",
        status=session_status,
        parent_session_id=root.id,
        lease_id=lease.id,
        runtime_id=runtime.id,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)
    return worker, lease


def _recording_ws_hub(monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, Any, str, dict]]:
    """把 ws_hub 换成录音 hub，捕获全部 WS 下发（同 cancel 集成测试模式）。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    captured: list[tuple[str, Any, str, dict]] = []

    class _RecordingHub:
        async def send_session_control(self, daemon_id, msg_type, payload):
            captured.append(("session_control", daemon_id, msg_type, payload))
            return True

        async def send_to_runtime(self, daemon_id, message):
            captured.append(("to_runtime", daemon_id, message))
            return True

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _RecordingHub())
    return captured


def _session_ends(captured: list[tuple[str, Any, str, dict]]) -> list[dict]:
    return [c[3] for c in captured if c[2] == DAEMON_MSG_SESSION_END]


# ── 1. 终态 mission 孤儿补收口 ───────────────────────────────────────────────


class TestOrphanScanEndsTerminalMissionWorkers:
    async def test_converged_mission_orphans_ended_via_run_once(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """converged 终态 + 三种活跃形态子会话（active/pending/reconnecting）→
        run_once 职责⑤逐个补发 end_session：子会话 ended + lease completed +
        SESSION_END 下发，计数进 orphan_sessions_ended（task-10 部分失败的
        下一轮补齐场景）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, _mission, user_id, rt = await _seed_tree(db_session, terminal="converged")
        workers: list[AgentSession] = []
        leases: list[DaemonTaskLease] = []
        for status in ("active", "pending", "reconnecting"):
            w, lease = await _seed_worker(
                db_session, root, owner_id=user_id, runtime=rt, session_status=status
            )
            workers.append(w)
            leases.append(lease)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["orphan_sessions_ended"] == 3
        for w, lease in zip(workers, leases, strict=True):
            await db_session.refresh(w)
            assert w.status == "ended"
            await db_session.refresh(lease)
            assert lease.status == "completed"
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w.id) for w in workers}

    async def test_cancelled_mission_orphans_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """cancelled 终态形态同样命中（cancel 链漏网兜底，方向与 converge 补齐一致）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, _mission, user_id, rt = await _seed_tree(db_session, terminal="cancelled")
        w1, l1 = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        w2, l2 = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 2
        for w, lease in ((w1, l1), (w2, l2)):
            await db_session.refresh(w)
            assert w.status == "ended"
            await db_session.refresh(lease)
            assert lease.status == "completed"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(w1.id), str(w2.id)}


# ── 2. 扫描范围：活跃 mission 不碰 / 存量零命中 / 已收口不重复 ────────────────


class TestOrphanScanScope:
    async def test_active_mission_workers_untouched(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """活跃 mission（未 converge 未 cancel）的子会话绝不被收口（独立查询
        方向与 _active_mission_ids 相反，不共用名单）。"""
        captured = _recording_ws_hub(monkeypatch)
        root, mission, user_id, rt = await _seed_tree(db_session, terminal="active")
        w, lease = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["orphan_sessions_ended"] == 0
        await db_session.refresh(w)
        assert w.status == "active", "活跃 mission 的子会话不得被收口"
        await db_session.refresh(lease)
        assert lease.status == "claimed"
        await db_session.refresh(mission)
        assert mission.converged_at is None and mission.cancelled_at is None
        assert _session_ends(captured) == []

    async def test_legacy_terminal_mission_zero_hits(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """存量 mission（session_id 随机 uuid 查无会话行、无子会话）终态扫描
        零命中零行为变化（FR-09）：枚举空集 no-op，零 WS 下发。"""
        captured = _recording_ws_hub(monkeypatch)
        mission = AgentMission(
            workspace_id=uuid.uuid4(),
            objective="存量团队目标",
            converged_at=datetime.now(UTC),
        )
        db_session.add(mission)
        await db_session.commit()

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 0
        assert captured == [], "存量 mission 无子会话零 WS 下发（枚举空集 no-op）"

    async def test_already_ended_worker_not_re_ended(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """已 ended 子会话不重复收口：end_session 幂等早退——lease 不被改写、
        不重发 SESSION_END，计数只含真孤儿。"""
        captured = _recording_ws_hub(monkeypatch)
        root, _mission, user_id, rt = await _seed_tree(db_session, terminal="converged")
        w_done, l_done = await _seed_worker(
            db_session, root, owner_id=user_id, runtime=rt, session_status="ended"
        )
        w_active, l_active = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 1
        await db_session.refresh(w_done)
        assert w_done.status == "ended"
        await db_session.refresh(l_done)
        assert l_done.status == "claimed", "幂等早退不得改写已收口子会话的 lease"
        await db_session.refresh(w_active)
        assert w_active.status == "ended"
        await db_session.refresh(l_active)
        assert l_active.status == "completed"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(w_active.id)}


# ── 3. best-effort 与异常隔离 ────────────────────────────────────────────────


class TestOrphanScanBestEffort:
    async def test_single_end_failure_does_not_block_others(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """单个收口失败（batch lease → DaemonSessionInvariantViolation）→
        log.warning 继续其余，计数只含成功者，失败子会话保持活跃（下轮再补）。"""
        captured = _recording_ws_hub(monkeypatch)
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)
        root, _mission, user_id, rt = await _seed_tree(db_session, terminal="converged")
        w1, _l1 = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
        # w2：lease kind=batch → end_session 抛 DaemonSessionInvariantViolation
        w2, _l2 = await _seed_worker(
            db_session, root, owner_id=user_id, runtime=rt, lease_kind="batch"
        )
        w3, _l3 = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 2, "单个收口失败不得阻断其余孤儿"
        await db_session.refresh(w1)
        assert w1.status == "ended"
        await db_session.refresh(w3)
        assert w3.status == "ended"
        await db_session.refresh(w2)
        assert w2.status == "active", "失败子会话保持活跃（下轮扫描再补）"
        assert {p["session_id"] for p in _session_ends(captured)} == {str(w1.id), str(w3.id)}
        warn_events = [c.args[0] for c in log_spy.warning.call_args_list]
        assert "mission_patrol_orphan_end_failed" in warn_events

    async def test_orphan_duty_failure_isolated_in_run_once(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """孤儿扫描职责整体抛错：只记 duty_failed(orphan_subsessions)，职责①
        计数照常透传（异常隔离对齐既有四职责）。"""
        log_spy = MagicMock()
        monkeypatch.setattr(patrol, "log", log_spy)

        async def _fake_convergence(
            self: MissionPatrolService, mission_ids: list[uuid.UUID]
        ) -> int:
            return 3

        async def _boom_orphan(self: MissionPatrolService) -> int:
            raise RuntimeError("boom on orphan duty")

        monkeypatch.setattr(MissionPatrolService, "_patrol_convergence", _fake_convergence)
        monkeypatch.setattr(MissionPatrolService, "_patrol_orphan_subsessions", _boom_orphan)

        counts = await MissionPatrolService(db_session).run_once()

        assert counts["converged"] == 3, "孤儿扫描崩溃不得阻断收敛兜底计数"
        assert counts["orphan_sessions_ended"] == 0
        log_spy.exception.assert_called_once_with(
            "mission_patrol_duty_failed", duty="orphan_subsessions"
        )


# ── 4. 独立查询 limit（防终态 mission 积压单轮过载）+ 最新终态优先（F02）────


class TestOrphanScanLimit:
    async def test_scan_limit_caps_terminal_missions_per_round(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """终态 mission 查询自带 limit（对齐 ``ACTIVE_MISSION_LIMIT`` 惯例）+
        **最新终态优先**（审计修复 F02：``created_at ASC`` 无时间窗在终态 mission
        超 limit 后饥饿——新终态 mission 的孤儿永远扫不到）：limit=2 时先收口
        终态时间最新的两个 mission 的孤儿，最老的一个留待下轮。"""
        captured = _recording_ws_hub(monkeypatch)
        monkeypatch.setattr(patrol, "ACTIVE_MISSION_LIMIT", 2)
        base = datetime(2026, 8, 25, 12, 0, 0, tzinfo=UTC)
        workers: list[AgentSession] = []
        for i in range(3):
            root, _mission, user_id, rt = await _seed_tree(
                db_session,
                terminal="converged",
                created_at=base + timedelta(minutes=i),
                terminal_at=base + timedelta(minutes=20 + i),
            )
            w, _l = await _seed_worker(db_session, root, owner_id=user_id, runtime=rt)
            workers.append(w)

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 2
        # 最新终态优先：终态时间 12:22 / 12:21 的两个先收口，12:20 最老的留待下轮。
        for w in workers[1:]:
            await db_session.refresh(w)
            assert w.status == "ended"
        await db_session.refresh(workers[0])
        assert workers[0].status == "active", "limit 之外的孤儿留待下一轮"
        assert len(_session_ends(captured)) == 2

    async def test_newest_terminal_mission_not_starved_by_backlog(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """F02 饥饿修复核心验收：终态 mission 积压超 limit（3 条老终态占满
        limit=3 的名单）时，**最新**终态 mission 的孤儿仍必须被扫到——
        ``created_at ASC`` 旧行为下新 mission 永远排在名单外，孤儿永不被收口
        （零孤儿承诺失效）。"""
        captured = _recording_ws_hub(monkeypatch)
        monkeypatch.setattr(patrol, "ACTIVE_MISSION_LIMIT", 3)
        base = datetime(2026, 8, 25, 10, 0, 0, tzinfo=UTC)
        # 3 条老终态 mission（无分身，纯名单占位）。
        for i in range(3):
            await _seed_tree(
                db_session,
                terminal="converged",
                created_at=base + timedelta(minutes=i),
                terminal_at=base + timedelta(minutes=10 + i),
            )
        # 最新终态 mission（终态时间最新 → 必须排进名单）带一个活跃孤儿。
        latest_root, _latest, latest_user, latest_rt = await _seed_tree(
            db_session,
            terminal="converged",
            created_at=base + timedelta(hours=1),
            terminal_at=base + timedelta(hours=2),
        )
        orphan, _lo = await _seed_worker(
            db_session, latest_root, owner_id=latest_user, runtime=latest_rt
        )

        ended = await MissionPatrolService(db_session)._patrol_orphan_subsessions()

        assert ended == 1, "最新终态 mission 的孤儿不得被老积压 mission 饥饿"
        await db_session.refresh(orphan)
        assert orphan.status == "ended"
        assert len(_session_ends(captured)) == 1


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
