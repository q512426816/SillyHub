"""2026-08-29-batch-session-inherit：worker 子会话分流挂起 + 自动重派（S1+S2）.

daemon 掉线两条挂起路径（``suspend_sessions_for_daemon`` 与
``session_offline_sweep_once``）按 ``parent_session_id`` 分流——**worker 子会话**
（parent 非空，识别唯一口径）改判 ``failed`` + ``ended_at``、活跃 run 落
``error_code=daemon_interrupted``（与主会话 ``daemon_stopped`` 区分来源，作
task-02 自动重派 --resume 继承的种子标识）、挂起 lease → ``cancelled``；
**主会话**（parent IS NULL）suspended 语义逐字不变（回归锁定）；
**offline sweep pending 档不加分流**（含 worker pending 维持既有 pending→failed
与无 error_code 现状——design 显式边界）。

task-01 部分锁定 S1 的落库/种子契约：worker 三态落库、
``SuspendBatchResult.workers`` 种子 ``(session_id, runtime_id)``、主会话零变化、
role 词表不参与识别。

task-02 部分锁定 S2 重派契约（``worker_redispatch.redispatch_worker_session``）：

- 重派全链——原 session 翻回 active + 新 pending interactive lease（metadata
  含 ``resume_session_id`` + 重渲染 prompt 含 objective 关键词 + role /
  tool_config）+ 新首 run 挂原会话挂原 mission；
- resume id 回退——``agent_session_id`` NULL 时取最新 run 的 ``session_id``；
- 守卫①——converged mission 不重派；守卫③——worker_force_end 标记 / 30min
  宽限窗外不重派；节流——同 session interactive lease 行数 >=3 不重派；
- 接线——suspend / sweep 事务后把 workers 种子交给
  ``fire_worker_redispatch`` 异步重派；
- patrol 职责④排除——``error_code=daemon_interrupted`` 的 run 不被
  worker_recovery 捞（防旧 run 翻回 pending 与新 run 双跑）。

task-06 追加集成回归（design S1-S4 契约表全链锁定，补缺不重复——守卫①③/
节流/patrol④/主会话 suspend 级回归已由上方既有类覆盖）：

- **全链**——suspend 落 failed(daemon_interrupted) 种子 → 消费种子真跑
  ``redispatch_worker_session`` → 新 lease metadata 含
  ``resume_session_id``（值=agent_session_id，回退变体=最新 run.session_id）
  + prompt 含 objective 关键词 + session 翻回 active + 新 pending run 挂原
  会话原 mission + WS 唤醒投递（契约表「worker 重派」行）；
- **主会话零破坏**——同 daemon 混合批（主会话+worker 均 active）：种子不含
  主会话，消费种子后主会话仍 suspended、run 落 daemon_stopped（语义逐字
  不变）、无新 lease / 无 pending run（契约表「主会话挂起/恢复」行）；
- **claim 集成**——重派新 lease 被认领时 ``build_claim_payload`` 输出含
  ``resume_session_id``（task-03 interactive 分支白名单透传的全链验证：从
  重派写入的 lease metadata 到 claim payload 一跳不丢，契约表「worker claim
  （带 resume）」行）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.session.service import (
    DAEMON_INTERRUPTED_ERROR_CODE,
    DAEMON_STOPPED_ERROR_CODE,
    SessionService,
)

# ── helpers（镜像 test_session_suspend 造数范式，本文件自带防跨文件耦合）──


@pytest.fixture(autouse=True)
def _stub_fire_redispatch(monkeypatch: pytest.MonkeyPatch) -> None:
    """把 ``fire_worker_redispatch`` 默认打成 no-op 桩。

    suspend / sweep 接线在事务后 ``asyncio.create_task`` 异步重派——真 task
    泄漏到测试事件循环会跨测试存活（pending 警告 / 干扰断言）。本文件除显式
    验证接线的用例（自行换捕获桩）外一律消费本桩；桩打在源模块属性上，
    service.py / sweep.py 的函数内 lazy import 读模块属性即取到桩。
    """
    from app.modules.agent import worker_redispatch as wr_mod

    monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: None)


async def _make_user(db: AsyncSession, *, prefix: str = "wrk") -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"{prefix}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name="wrk",
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_instance(db: AsyncSession, user_id: uuid.UUID) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
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
    heartbeat: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=heartbeat if heartbeat is not None else datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_lease(
    db: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    status: str = "claimed",
    metadata_session_id: str = "sdk-sess",
) -> DaemonTaskLease:
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="interactive",
        status=status,
        claimed_at=now if status == "claimed" else None,
        lease_expires_at=None,  # interactive lease 恒 NULL
        attempt_number=1,
        metadata_={"session_id": metadata_session_id, "claim_token": "tok-old"},
        created_at=now,
        updated_at=now,
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
    parent_session_id: uuid.UUID | None = None,
    role: str | None = None,
    last_active_at: datetime | None = None,
    agent_session_id: str | None = "auto",
    workspace_id: uuid.UUID | None = None,
    tree_depth: int = 1,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=lease_id,
        provider="claude",
        status=status,
        agent_session_id=(
            f"sdk-{uuid.uuid4().hex[:8]}" if agent_session_id == "auto" else agent_session_id
        ),
        config={"model": "sonnet"},
        turn_count=1,
        cwd="/workspace/proj",
        parent_session_id=parent_session_id,
        role=role,
        workspace_id=workspace_id,
        tree_depth=tree_depth,
        created_at=now,
        last_active_at=last_active_at if last_active_at is not None else now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_run(
    db: AsyncSession,
    session_id: uuid.UUID,
    *,
    status: str = "running",
    error_code: str | None = None,
    mission_id: uuid.UUID | None = None,
    objective: str | None = None,
    role: str | None = None,
    read_only: bool | None = None,
    worktree_branch: str | None = None,
    model: str | None = None,
    run_session_id: str | None = None,
    created_at: datetime | None = None,
    resume_token: str | None = None,
) -> AgentRun:
    run = AgentRun(
        agent_type="claude_code",
        status=status,
        agent_session_id=session_id,
        error_code=error_code,
        mission_id=mission_id,
        objective=objective,
        role=role,
        read_only=read_only,
        worktree_branch=worktree_branch,
        model=model,
        session_id=run_session_id,
        spec_strategy="interactive",
        resume_token=resume_token,
        created_at=created_at if created_at is not None else datetime.now(UTC),
    )
    db.add(run)
    await db.commit()
    return run


async def _make_workspace(db: AsyncSession) -> uuid.UUID:
    """建真实 workspace 行（mission.workspace_id FK 完整，照 test_patrol 惯例）。"""
    from app.modules.workspace.model import Workspace

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    db.add(ws)
    await db.commit()
    return ws_id


async def _make_mission(
    db: AsyncSession,
    ws_id: uuid.UUID,
    *,
    session_id: uuid.UUID | None = None,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
    constraints: dict | None = None,
) -> AgentMission:
    mission = AgentMission(
        workspace_id=ws_id,
        objective=f"mission-{uuid.uuid4().hex[:8]}",
        constraints=constraints,
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    if session_id is not None:
        mission.session_id = session_id
    db.add(mission)
    await db.commit()
    return mission


async def _lease_status(db: AsyncSession, lease_id: uuid.UUID) -> str:
    return (
        await db.execute(select(DaemonTaskLease.status).where(DaemonTaskLease.id == lease_id))
    ).scalar_one()


async def _run_row(db: AsyncSession, run_id: uuid.UUID):
    return (
        await db.execute(
            select(AgentRun.status, AgentRun.error_code, AgentRun.finished_at).where(
                AgentRun.id == run_id
            )
        )
    ).one()


async def _session_row(db: AsyncSession, session_id: uuid.UUID):
    return (
        await db.execute(
            select(
                AgentSession.status,
                AgentSession.ended_at,
                AgentSession.last_active_at,
            ).where(AgentSession.id == session_id)
        )
    ).one()


def _capture_publish(monkeypatch: pytest.MonkeyPatch, module_path: str) -> list[tuple]:
    """把 ``module_path.publish_sessions_changed`` 换成捕获桩，返回调用记录。"""
    calls: list[tuple] = []

    async def _fake_publish(event, session_id, user_id):
        calls.append((event, session_id, user_id))

    monkeypatch.setattr(f"{module_path}.publish_sessions_changed", _fake_publish)
    return calls


def _capture_redis(monkeypatch: pytest.MonkeyPatch, module_path: str) -> list[tuple[str, str]]:
    """捕获 ``module_path`` 所在模块 per-session 频道（``agent_session:{id}``）publish。"""
    import importlib

    mod = importlib.import_module(module_path)
    captured: list[tuple[str, str]] = []

    class _FakeRedis:
        async def publish(self, channel: str, payload: str) -> int:
            captured.append((channel, payload))
            return 1

    monkeypatch.setattr(mod, "get_redis", lambda: _FakeRedis())
    return captured


# ── 1. suspend-batch 路径：worker 三态落库 + workers 种子 ─────────────────────


class TestSuspendBatchWorkerSeed:
    async def test_worker_three_states_persisted(self, db_session: AsyncSession) -> None:
        """worker 三态：session=failed+ended_at、run=failed+daemon_interrupted+
        finished_at、lease=cancelled；workers 种子返回 (session_id, runtime_id)。"""
        user = await _make_user(db_session)
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        lease = await _make_lease(db_session, rt.id, status="claimed")
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=lease.id,
            parent_session_id=parent.id,
            role="worker",
        )
        run = await _make_run(db_session, worker.id, status="running")

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 0  # worker 不再计入 suspended
        assert result.runs_failed == 1
        assert result.workers == [(worker.id, rt.id)]
        row = await _session_row(db_session, worker.id)
        assert row.status == "failed"
        assert row.ended_at is not None
        run_row = await _run_row(db_session, run.id)
        assert run_row.status == "failed"
        assert run_row.error_code == DAEMON_INTERRUPTED_ERROR_CODE
        assert run_row.finished_at is not None
        assert await _lease_status(db_session, lease.id) == "cancelled"

    async def test_workers_seed_maps_session_to_runtime(self, db_session: AsyncSession) -> None:
        """同 daemon 多 runtime 多 worker：种子逐 worker 映射各自 runtime_id
        （task-02 派发路由键），不混批。"""
        user = await _make_user(db_session, prefix="wrk-map")
        inst = await _make_instance(db_session, user.id)
        rt1 = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        rt2 = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        parent = await _make_session(db_session, user.id, rt1.id, status="ended", lease_id=None)
        w1 = await _make_session(
            db_session, user.id, rt1.id, status="active", lease_id=None, parent_session_id=parent.id
        )
        w2 = await _make_session(
            db_session, user.id, rt2.id, status="active", lease_id=None, parent_session_id=parent.id
        )

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 0
        # DB 返回序不保证，按 dict 对值（session_id → runtime_id 一一对应）。
        assert dict(result.workers) == {w1.id: rt1.id, w2.id: rt2.id}

    async def test_main_session_suspended_regression_locked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主会话（parent IS NULL）回归锁定：suspended+last_active_at 刷新、run
        error_code=daemon_stopped、不发 session_ended、workers 种子为空。"""
        captured = _capture_redis(monkeypatch, "app.modules.daemon.session.service")
        calls = _capture_publish(monkeypatch, "app.modules.daemon.session.service")
        user = await _make_user(db_session, prefix="wrk-main")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        lease = await _make_lease(db_session, rt.id, status="claimed")
        main = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, main.id, status="running")
        old_last_active = main.last_active_at

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 1
        assert result.workers == []
        row = await _session_row(db_session, main.id)
        assert row.status == "suspended"
        assert row.ended_at is None
        new_last_active = row.last_active_at
        if new_last_active.tzinfo is None:
            new_last_active = new_last_active.replace(tzinfo=UTC)
        assert new_last_active > old_last_active
        run_row = await _run_row(db_session, run.id)
        assert run_row.status == "failed"
        assert run_row.error_code == DAEMON_STOPPED_ERROR_CODE
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{main.id}"]
        assert not any(e.get("event") == "session_ended" for e in events)
        assert calls == [("status_changed", main.id, user.id)]

    async def test_identification_by_parent_only_role_ignored(
        self, db_session: AsyncSession
    ) -> None:
        """识别唯一口径锁定：role=worker 但 parent IS NULL 的会话仍 suspended
        （禁用 role 词表兜底）；role=NULL 但 parent 非空的老 worker 行走 failed。"""
        user = await _make_user(db_session, prefix="wrk-role")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        # role=worker 但无 parent：主会话语义（存量 orchestrator 行），不判 worker。
        main = await _make_session(
            db_session, user.id, rt.id, status="active", lease_id=None, role="worker"
        )
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        # role=NULL 老 worker 行：parent 非空即 worker（兼容口径）。
        legacy_worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=parent.id,
            role=None,
        )

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.suspended == 1
        assert result.workers == [(legacy_worker.id, rt.id)]
        assert (await _session_row(db_session, main.id)).status == "suspended"
        assert (await _session_row(db_session, legacy_worker.id)).status == "failed"


# ── 2. offline sweep 路径：active 档同款分流 / pending 档不分流 ───────────────


class TestOfflineSweepWorkerSeed:
    async def test_worker_active_three_states_persisted(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """offline sweep active 档 worker 分流：session failed+ended_at、run
        failed+daemon_interrupted、lease cancelled；终态发 session_ended
        （reason=runtime_offline）+ status_changed。"""
        from app.modules.daemon import sweep as sweep_mod

        captured = _capture_redis(monkeypatch, "app.modules.daemon.sweep")
        calls = _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="wrk-off")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 60),
        )
        lease = await _make_lease(db_session, rt.id, status="claimed")
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=lease.id,
            parent_session_id=parent.id,
            role="worker",
        )
        run = await _make_run(db_session, worker.id, status="running")

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, worker.id)
        assert row.status == "failed"
        assert row.ended_at is not None
        run_row = await _run_row(db_session, run.id)
        assert run_row.status == "failed"
        assert run_row.error_code == DAEMON_INTERRUPTED_ERROR_CODE
        assert await _lease_status(db_session, lease.id) == "cancelled"
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{worker.id}"]
        assert any(
            e.get("event") == "session_ended" and e.get("reason") == "runtime_offline"
            for e in events
        )
        assert calls == [("status_changed", worker.id, user.id)]

    async def test_main_active_suspended_regression_locked(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """offline sweep 主会话回归锁定：active→suspended、run failed 但不落
        error_code（既有现状）、不发 session_ended。"""
        from app.modules.daemon import sweep as sweep_mod

        captured = _capture_redis(monkeypatch, "app.modules.daemon.sweep")
        _capture_publish(monkeypatch, "app.modules.daemon.sweep")
        user = await _make_user(db_session, prefix="wrk-off-m")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 120),
        )
        lease = await _make_lease(db_session, rt.id, status="claimed")
        main = await _make_session(db_session, user.id, rt.id, status="active", lease_id=lease.id)
        run = await _make_run(db_session, main.id, status="running")

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, main.id)
        assert row.status == "suspended"
        assert row.ended_at is None
        run_row = await _run_row(db_session, run.id)
        assert run_row.status == "failed"
        assert run_row.error_code is None  # 既有 offline sweep 主会话 run 不落 error_code
        events = [json.loads(p) for ch, p in captured if ch == f"agent_session:{main.id}"]
        assert not any(e.get("event") == "session_ended" for e in events)

    async def test_worker_pending_tier_unsplit(self, db_session: AsyncSession) -> None:
        """pending 档不加分流（design 显式边界）：worker pending 仍 pending→
        failed+ended_at，run 收敛 failed 但不落 daemon_interrupted。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session, prefix="wrk-off-p")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 300),
        )
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="pending",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        run = await _make_run(db_session, worker.id, status="pending")

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 1
        row = await _session_row(db_session, worker.id)
        assert row.status == "failed"
        assert row.ended_at is not None
        run_row = await _run_row(db_session, run.id)
        assert run_row.status == "failed"
        assert run_row.error_code is None

    async def test_worker_round_idempotent(self, db_session: AsyncSession) -> None:
        """worker 档二跑幂等：首轮收敛后第二轮 0 行，failed/error_code 原样。"""
        from app.modules.daemon import sweep as sweep_mod

        user = await _make_user(db_session, prefix="wrk-idem")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC) - timedelta(hours=1),
        )
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        run = await _make_run(db_session, worker.id, status="running")

        first = await sweep_mod.session_offline_sweep_once(db_session)
        second = await sweep_mod.session_offline_sweep_once(db_session)

        assert (first, second) == (1, 0)
        assert (await _session_row(db_session, worker.id)).status == "failed"
        assert (await _run_row(db_session, run.id)).error_code == DAEMON_INTERRUPTED_ERROR_CODE


# ── 3. task-02 重派全链（design S2：复用原会话 + resume 注入 + 上下文重建）──


class TestRedispatchFullChain:
    async def test_redispatch_rebuilds_session_with_resume(self, db_session: AsyncSession) -> None:
        """重派全链：session 翻回 active+清 ended_at+turn_count 归 0+绑新 lease；
        新 pending interactive lease metadata 含 resume_session_id（原
        agent_session_id）+ 重渲染 prompt 含 objective 关键词与 git 约束段 +
        role / tool_config；新首 run 挂原会话挂原 mission 复制派发参数。"""
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        user = await _make_user(db_session, prefix="wrk-rd")
        rt = await _make_runtime(
            db_session, user.id
        )  # online + 无 daemon_instance_id → WS 复查放行
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        old_lease = await _make_lease(db_session, rt.id, status="cancelled")
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=old_lease.id,
            parent_session_id=main.id,
            role="worker",
            workspace_id=ws_id,
            agent_session_id="sdk-resume-key",
        )
        first_run = await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="实现登录鉴权模块",
            role="impl",
            read_only=False,
            worktree_branch="wt/worker-1",
            model="sonnet",
            created_at=datetime.now(UTC) - timedelta(minutes=5),
        )

        lease_id = await redispatch_worker_session(db_session, worker.id)

        assert lease_id is not None and lease_id != old_lease.id
        # session 翻回 active：新一轮语义（ended_at 清空 / turn_count 归 0 / 绑新 lease）。
        sess = await db_session.get(AgentSession, worker.id)
        assert sess is not None
        assert sess.status == "active"
        assert sess.ended_at is None
        assert sess.turn_count == 0
        assert sess.lease_id == lease_id
        assert sess.runtime_id == rt.id
        # 新 lease：pending interactive，metadata 重建完整派发上下文。
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert lease.status == "pending"
        assert lease.kind == "interactive"
        meta = lease.metadata_ or {}
        assert meta["session_id"] == str(worker.id)  # 归属锚（下次节流计数键）
        assert meta["resume_session_id"] == "sdk-resume-key"
        assert "实现登录鉴权模块" in meta["prompt"]
        assert "worktree 协作约束" in meta["prompt"]  # worktree_branch 非空 → git 模式段
        assert meta["role"] == "impl"
        assert meta["tool_config"]["mode"] == "acceptEdits"  # read_only=False 物制
        assert meta["stage"] == "mission_worker"
        assert meta["worker_depth"] == 1
        # 新首 run：pending interactive 挂原会话挂原 mission，派发参数复制。
        new_run = (
            await db_session.execute(
                select(AgentRun).where(
                    AgentRun.agent_session_id == worker.id,
                    AgentRun.status == "pending",
                )
            )
        ).scalar_one()
        assert new_run.mission_id == mission.id
        assert new_run.objective == first_run.objective
        assert new_run.role == first_run.role
        assert new_run.read_only == first_run.read_only
        assert new_run.worktree_branch == first_run.worktree_branch
        assert new_run.spec_strategy == "interactive"
        assert meta["run_id"] == str(new_run.id)

    async def test_resume_id_falls_back_to_latest_run_session_id(
        self, db_session: AsyncSession
    ) -> None:
        """resume id 回退：session.agent_session_id NULL 时取该会话最新 run 的
        session_id（_heal_agent_session_id_from_runs 同源逻辑，只读不写回）。"""
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        user = await _make_user(db_session, prefix="wrk-fb")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
            agent_session_id=None,
        )
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="回退目标",
            role="worker",
            run_session_id="sdk-from-run",
        )

        lease_id = await redispatch_worker_session(db_session, worker.id)

        assert lease_id is not None
        lease = await db_session.get(DaemonTaskLease, lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("resume_session_id") == "sdk-from-run"


# ── 4. task-02 互斥守卫 + 节流（design S2）──────────────────────────────────


class TestRedispatchGuards:
    async def test_converged_mission_not_redispatched(self, db_session: AsyncSession) -> None:
        """守卫①：converged mission 不重派（session 留 failed，无新 lease）。"""
        from app.modules.agent.worker_redispatch import (
            REDISPATCH_MAX_ATTEMPTS,
            redispatch_worker_session,
        )

        user = await _make_user(db_session, prefix="wrk-g1")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(
            db_session, ws_id, session_id=main.id, converged_at=datetime.now(UTC)
        )
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="收敛后目标",
            role="worker",
        )

        assert await redispatch_worker_session(db_session, worker.id) is None
        assert (await _session_row(db_session, worker.id)).status == "failed"
        # 无新 lease：该 session 名下 interactive lease 仍为 0。
        cnt = len(
            (
                await db_session.execute(
                    select(DaemonTaskLease.id).where(
                        DaemonTaskLease.kind == "interactive",
                        DaemonTaskLease.metadata_["session_id"].as_string()  # type: ignore[index]
                        == str(worker.id),
                    )
                )
            ).all()
        )
        assert cnt == 0
        assert REDISPATCH_MAX_ATTEMPTS == 3

    async def test_throttle_three_leases_blocks_redispatch(self, db_session: AsyncSession) -> None:
        """节流：同 session 名下 interactive 历史 lease 行数 >=3（含首轮）不再
        重派，session 留 failed 终态。"""
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        user = await _make_user(db_session, prefix="wrk-th")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="节流目标",
            role="worker",
        )
        for _ in range(3):
            await _make_lease(db_session, rt.id, metadata_session_id=str(worker.id))

        assert await redispatch_worker_session(db_session, worker.id) is None
        assert (await _session_row(db_session, worker.id)).status == "failed"

    async def test_force_ended_marker_blocks_redispatch(self, db_session: AsyncSession) -> None:
        """守卫③（标记形态）：mission.constraints 已带 worker_force_ended_at
        单向标记（patrol 职责⑦置位，derive 已映 failed）不重派。"""
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        user = await _make_user(db_session, prefix="wrk-g3a")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(
            db_session,
            ws_id,
            session_id=main.id,
            constraints={"worker_force_ended_at": datetime.now(UTC).isoformat()},
        )
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="标记目标",
            role="worker",
        )

        assert await redispatch_worker_session(db_session, worker.id) is None
        assert (await _session_row(db_session, worker.id)).status == "failed"

    async def test_grace_window_expired_blocks_redispatch(self, db_session: AsyncSession) -> None:
        """守卫③（窗口形态）：会话 failed 终态超 30min 宽限窗（patrol 职责⑦
        即将置标 / mission derive 映 failed）不重派——重派成功也救不回。"""
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        user = await _make_user(db_session, prefix="wrk-g3b")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        # ended_at 推到 31min 前（宽限窗默认 30min 之外）。
        worker.ended_at = datetime.now(UTC) - timedelta(minutes=31)
        db_session.add(worker)
        await db_session.commit()
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="超窗目标",
            role="worker",
        )

        assert await redispatch_worker_session(db_session, worker.id) is None
        assert (await _session_row(db_session, worker.id)).status == "failed"


# ── 5. task-02 接线：suspend / sweep 事务后异步 fire workers 种子 ───────────


class TestWiringFiresSeeds:
    async def test_suspend_fires_workers_seed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """suspend 接线：worker failed 落库事务提交后把 workers 种子交给
        fire_worker_redispatch（异步重派入口）。"""
        from app.modules.agent import worker_redispatch as wr_mod

        captured: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(
            wr_mod, "fire_worker_redispatch", lambda workers: captured.append(workers)
        )
        user = await _make_user(db_session, prefix="wrk-w1")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )

        await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert captured == [[(worker.id, rt.id)]]

    async def test_suspend_main_only_batch_does_not_fire(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主会话-only 批不 fire（workers 种子为空短路）。"""
        from app.modules.agent import worker_redispatch as wr_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-w2")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        await _make_session(db_session, user.id, rt.id, status="active", lease_id=None)

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        assert result.workers == []
        assert fired == []

    async def test_offline_sweep_fires_workers_seed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """sweep 接线：offline sweep worker active 档事务提交后 fire 种子；
        主会话档不 fire。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.daemon import sweep as sweep_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-w3")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 90),
        )
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        main = await _make_session(db_session, user.id, rt.id, status="active", lease_id=None)

        await sweep_mod.session_offline_sweep_once(db_session)

        assert fired == [[(worker.id, rt.id)]]
        assert (await _session_row(db_session, main.id)).status == "suspended"


# ── 6. task-02 patrol 职责④排除（互斥守卫②：防双跑）───────────────────────


class TestPatrolWorkerRecoveryExclusion:
    async def test_daemon_interrupted_run_not_recovered(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """patrol 职责④排除：error_code=daemon_interrupted 的 run 不进
        worker_recovery 候选（不走 resume 翻回 pending——防与重派新 run 双跑）；
        同批无 error_code 的既有候选照常 resume（回归对照）。

        两条 run 都带 resume_token（ql-20260903-013：6a2248ccc 起职责④跳过
        NULL token 候选，对照 run 缺 token 会被 token 守卫挡下导致 recovered=0），
        使中断 run 的排除只可能来自 error_code 过滤——本测试的原始意图。"""
        from unittest.mock import AsyncMock

        from app.modules.agent.coordinator import ExecutionCoordinatorService
        from app.modules.agent.patrol import MissionPatrolService

        resume_mock = AsyncMock(return_value=1)
        monkeypatch.setattr(ExecutionCoordinatorService, "resume_run", resume_mock)

        user = await _make_user(db_session, prefix="wrk-p4")
        rt = await _make_runtime(db_session, user.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="active", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker_a = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        worker_b = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
        )
        interrupted_run = await _make_run(
            db_session,
            worker_a.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            mission_id=mission.id,
            objective="被中断的分身",
            role="worker",
            resume_token="tok-interrupted",
        )
        control_run = await _make_run(
            db_session,
            worker_b.id,
            status="failed",
            error_code=None,
            mission_id=mission.id,
            objective="既有断线分身",
            role="worker",
            resume_token="tok-control",
        )

        recovered = await MissionPatrolService(db_session)._patrol_worker_recovery()

        assert recovered == 1  # 仅对照 run 走 resume
        resumed_ids = {call.args[0] for call in resume_mock.await_args_list}
        assert control_run.id in resumed_ids
        assert interrupted_run.id not in resumed_ids
        # 被排除的 run 保持 failed 终态（未被翻回 pending）。
        assert (await _run_row(db_session, interrupted_run.id)).status == "failed"


# ── 7. task-06 集成全链：suspend 种子 → 重派 →（claim payload）──────────────


class _FakeWsHub:
    """进程级 ws_hub 假件：钉定 runtime 的 WS 实连复查 + wakeup 投递捕获。

    ``_runtime_row_ws_alive``（placement.py）对 daemon_instance_id 非空的
    runtime 要求 hub ``is_connected`` 才放行派发——重派全链的 runtime 挂在
    daemon instance 名下（suspend 按 instance 分组），须打桩模拟「优雅停止
    窗口：suspend-batch 时 WS 尚未断」（daemon stop() 先 suspend 后断连）。
    打桩点 ``app.modules.daemon.ws_hub.get_daemon_ws_hub`` 为 placement 注释
    认可的测试口。
    """

    def __init__(self, connected: set[uuid.UUID]) -> None:
        self._connected = connected
        self.wakeups: list[tuple[uuid.UUID, dict]] = []

    @property
    def connected_daemon_ids(self) -> list[uuid.UUID]:
        return list(self._connected)

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        return daemon_id in self._connected

    async def send_wakeup(self, daemon_id: uuid.UUID, **kwargs: object) -> None:
        self.wakeups.append((daemon_id, dict(kwargs)))


class TestFullChainSuspendToRedispatch:
    """task-06：daemon 挂起 → workers 种子 → 真跑重派 → 续会话上下文全链。"""

    async def test_full_chain_primary_agent_session_id(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """全链（resume 值=agent_session_id 主源）：suspend 落 worker
        failed(daemon_interrupted) 种子 → 消费种子重派 → 新 lease metadata 含
        resume_session_id + prompt 含 objective 关键词 + session 翻回 active +
        新 pending run 挂原会话原 mission + commit 后 WS wakeup 投递。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        hub = _FakeWsHub(connected=set())
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        seeds: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: seeds.append(workers))
        _capture_redis(monkeypatch, "app.modules.daemon.session.service")
        _capture_publish(monkeypatch, "app.modules.daemon.session.service")

        user = await _make_user(db_session, prefix="wrk-fc")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        # 模拟优雅停止窗口：suspend-batch 落库时 daemon WS 仍在（钉定复查放行）。
        hub._connected.add(inst.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        old_lease = await _make_lease(db_session, rt.id, status="claimed")
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=old_lease.id,
            parent_session_id=main.id,
            role="worker",
            workspace_id=ws_id,
            agent_session_id="sdk-fullchain-key",
        )
        await _make_run(
            db_session,
            worker.id,
            status="running",
            mission_id=mission.id,
            objective="实现登录鉴权模块",
            role="impl",
            read_only=False,
            worktree_branch="wt/worker-9",
            model="sonnet",
        )

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        # ── 挂起分流落库（task-01 契约在全链中复核）──
        assert result.workers == [(worker.id, rt.id)]
        assert seeds == [[(worker.id, rt.id)]]
        run_row = (
            await db_session.execute(
                select(AgentRun.status, AgentRun.error_code).where(
                    AgentRun.agent_session_id == worker.id
                )
            )
        ).one()
        assert run_row.status == "failed"
        assert run_row.error_code == DAEMON_INTERRUPTED_ERROR_CODE
        assert await _lease_status(db_session, old_lease.id) == "cancelled"

        # ── 消费种子（模拟 _redispatch_task 体，同 session 同步跑）──
        new_lease_id = await redispatch_worker_session(db_session, seeds[0][0][0])

        assert new_lease_id is not None and new_lease_id != old_lease.id
        sess = await db_session.get(AgentSession, worker.id)
        assert sess is not None
        assert sess.status == "active"
        assert sess.ended_at is None
        assert sess.lease_id == new_lease_id
        assert sess.runtime_id == rt.id  # 原 runtime 钉定（worktree 机器局部）
        lease = await db_session.get(DaemonTaskLease, new_lease_id)
        assert lease is not None
        assert lease.status == "pending"
        assert lease.kind == "interactive"
        meta = lease.metadata_ or {}
        assert meta["session_id"] == str(worker.id)
        # resume 值 = 原 agent_session_id（主源）。
        assert meta["resume_session_id"] == "sdk-fullchain-key"
        assert "实现登录鉴权模块" in meta["prompt"]
        assert meta["stage"] == "mission_worker"
        new_run = (
            await db_session.execute(
                select(AgentRun).where(
                    AgentRun.agent_session_id == worker.id,
                    AgentRun.status == "pending",
                )
            )
        ).scalar_one()
        assert new_run.mission_id == mission.id  # 新 run 挂原会话原 mission
        assert meta["run_id"] == str(new_run.id)
        # commit 后唤醒原 daemon（WS 连接窗口内投递成功）。
        assert len(hub.wakeups) == 1
        assert hub.wakeups[0][0] == inst.id

    async def test_full_chain_resume_falls_back_to_run_session_id(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """全链回退变体：session.agent_session_id NULL → 重派 lease metadata 的
        resume_session_id 取该会话 run 的 session_id（SDK 落库层 resume 锚）。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        hub = _FakeWsHub(connected=set())
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        seeds: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: seeds.append(workers))
        _capture_redis(monkeypatch, "app.modules.daemon.session.service")
        _capture_publish(monkeypatch, "app.modules.daemon.session.service")

        user = await _make_user(db_session, prefix="wrk-fcfb")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        hub._connected.add(inst.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
            agent_session_id=None,
        )
        await _make_run(
            db_session,
            worker.id,
            status="running",
            mission_id=mission.id,
            objective="回退全链目标",
            role="worker",
            run_session_id="sdk-run-level-key",
        )

        await SessionService(db_session).suspend_sessions_for_daemon(inst.id)
        new_lease_id = await redispatch_worker_session(db_session, seeds[0][0][0])

        assert new_lease_id is not None
        lease = await db_session.get(DaemonTaskLease, new_lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("resume_session_id") == "sdk-run-level-key"
        assert "回退全链目标" in (lease.metadata_ or {}).get("prompt", "")

    async def test_mixed_batch_main_session_zero_destruction(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """主会话零破坏（design 目标 2 / 契约表「主会话挂起/恢复」行）：同
        daemon 混合批（主会话+worker 子会话均 active）——workers 种子不含主会话；
        消费种子重派后主会话仍 suspended（daemon_stopped 语义逐字不变）、无新
        lease、无新 pending run。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.agent.worker_redispatch import redispatch_worker_session

        hub = _FakeWsHub(connected=set())
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        seeds: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: seeds.append(workers))
        _capture_redis(monkeypatch, "app.modules.daemon.session.service")
        _capture_publish(monkeypatch, "app.modules.daemon.session.service")

        user = await _make_user(db_session, prefix="wrk-fcmix")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        hub._connected.add(inst.id)
        ws_id = await _make_workspace(db_session)
        main_lease = await _make_lease(db_session, rt.id, status="claimed")
        main = await _make_session(
            db_session, user.id, rt.id, status="active", lease_id=main_lease.id
        )
        main_run = await _make_run(db_session, main.id, status="running")
        worker_lease = await _make_lease(db_session, rt.id, status="claimed")
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=worker_lease.id,
            parent_session_id=main.id,
            role="worker",
            workspace_id=ws_id,
        )
        await _make_run(
            db_session,
            worker.id,
            status="running",
            mission_id=(await _make_mission(db_session, ws_id, session_id=main.id)).id,
            objective="混合批目标",
            role="worker",
        )

        result = await SessionService(db_session).suspend_sessions_for_daemon(inst.id)

        # 种子只含 worker，主会话不在重派面。
        assert result.suspended == 1
        assert result.workers == [(worker.id, rt.id)]
        assert seeds == [[(worker.id, rt.id)]]
        assert main.id not in {sid for sid, _ in seeds[0]}
        # 消费种子（worker 重派全跑通）后复核主会话零破坏。
        assert await redispatch_worker_session(db_session, seeds[0][0][0]) is not None
        main_row = await _session_row(db_session, main.id)
        assert main_row.status == "suspended"  # 不走 failed/重派
        assert main_row.ended_at is None
        main_run_row = await _run_row(db_session, main_run.id)
        assert main_run_row.status == "failed"
        assert main_run_row.error_code == DAEMON_STOPPED_ERROR_CODE  # 语义逐字不变
        assert await _lease_status(db_session, main_lease.id) == "cancelled"
        # 主会话名下无新 interactive lease、无 pending run（未被重派触碰）。
        main_leases = (
            await db_session.execute(
                select(DaemonTaskLease.id).where(
                    DaemonTaskLease.kind == "interactive",
                    DaemonTaskLease.metadata_["session_id"].as_string()  # type: ignore[index]
                    == str(main.id),
                )
            )
        ).all()
        assert main_leases == []
        main_pending = (
            await db_session.execute(
                select(AgentRun.id).where(
                    AgentRun.agent_session_id == main.id,
                    AgentRun.status == "pending",
                )
            )
        ).all()
        assert main_pending == []


# ── 8. task-06 claim 集成：重派 lease → build_claim_payload 全链 ────────────


class TestRedispatchClaimIntegration:
    """task-06：重派写入的 lease metadata → claim payload 一跳不丢（task-03
    interactive 分支白名单透传的全链验证——单测（test_build_claim_payload.py）
    造的是手工 metadata，本类从重派真链路产出的 lease 起跑）。"""

    async def test_redispatched_lease_claim_payload_carries_resume(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """重派新 lease 被认领（status=claimed）时 build_claim_payload 输出：
        kind=interactive + resume_session_id（原 agent_session_id）+ prompt 含
        objective + agent_session_id/agent_run_id 锚 + stage=mission_worker +
        root_path=cwd（workdir 一致性锚）。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.agent.worker_redispatch import redispatch_worker_session
        from app.modules.daemon.lease.context import build_claim_payload

        hub = _FakeWsHub(connected=set())
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        seeds: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: seeds.append(workers))
        _capture_redis(monkeypatch, "app.modules.daemon.session.service")
        _capture_publish(monkeypatch, "app.modules.daemon.session.service")

        user = await _make_user(db_session, prefix="wrk-cli")
        inst = await _make_instance(db_session, user.id)
        rt = await _make_runtime(db_session, user.id, daemon_instance_id=inst.id)
        hub._connected.add(inst.id)
        ws_id = await _make_workspace(db_session)
        main = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        mission = await _make_mission(db_session, ws_id, session_id=main.id)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="active",
            lease_id=None,
            parent_session_id=main.id,
            role="worker",
            workspace_id=ws_id,
            agent_session_id="sdk-claim-key",
        )
        await _make_run(
            db_session,
            worker.id,
            status="running",
            mission_id=mission.id,
            objective="实现登录鉴权模块",
            role="impl",
        )

        await SessionService(db_session).suspend_sessions_for_daemon(inst.id)
        new_lease_id = await redispatch_worker_session(db_session, seeds[0][0][0])
        assert new_lease_id is not None
        new_run = (
            await db_session.execute(
                select(AgentRun).where(
                    AgentRun.agent_session_id == worker.id,
                    AgentRun.status == "pending",
                )
            )
        ).scalar_one()

        # daemon claim：lease 翻 claimed 后按 claim 路径构造 payload。
        lease = await db_session.get(DaemonTaskLease, new_lease_id)
        assert lease is not None
        lease.status = "claimed"
        lease.claimed_at = datetime.now(UTC)
        db_session.add(lease)
        await db_session.commit()

        payload = await build_claim_payload(db_session, lease)

        assert payload["kind"] == "interactive"
        assert payload["resume_session_id"] == "sdk-claim-key"
        assert payload["agent_session_id"] == str(worker.id)
        assert payload["agent_run_id"] == str(new_run.id)
        assert "实现登录鉴权模块" in (payload["prompt"] or "")
        assert payload["stage"] == "mission_worker"
        assert payload["root_path"] == "/workspace/proj"  # 原 cwd 复用（workdir 锚）


class TestSweepRedispatchRetrySeeds:
    """2026-08-30 审计⑤：重派失败自愈链修复。

    上轮 sweep fire 后 NoOnlineDaemonError 返回 None 的 worker 会话停留 failed
    （离线档只选 active/pending，此前永不再被选中——「下轮 sweep 自愈」承诺无
    实现）。修复后每轮顺带捞「failed worker + 末次 run 仍为 daemon_interrupted
    + 原 runtime 已回在线 + 宽限窗内」重 fire；runtime 未回归 / 末次 run 非中断
    / 超窗均不 fire。
    """

    async def test_failed_worker_with_online_runtime_refired(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """正例：runtime 回归在线 + 末次 run=daemon_interrupted + 窗内 → 重 fire。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.daemon import sweep as sweep_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-r1")
        rt = await _make_runtime(db_session, user.id, status="online")
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        await _make_run(
            db_session, worker.id, status="failed", error_code=DAEMON_INTERRUPTED_ERROR_CODE
        )

        converged = await sweep_mod.session_offline_sweep_once(db_session)

        assert converged == 0  # 无新离线收敛，纯重试种子
        assert fired == [[(worker.id, rt.id)]]

    async def test_runtime_still_offline_not_refired(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """反例：runtime 仍离线 → 不 fire（fire 必 NoOnlineDaemonError，零无效任务）。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.daemon import sweep as sweep_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-r2")
        rt = await _make_runtime(
            db_session,
            user.id,
            status="offline",
            heartbeat=datetime.now(UTC)
            - timedelta(seconds=sweep_mod.RUNTIME_OFFLINE_GRACE_SEC + 90),
        )
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        await _make_run(
            db_session, worker.id, status="failed", error_code=DAEMON_INTERRUPTED_ERROR_CODE
        )

        await sweep_mod.session_offline_sweep_once(db_session)

        assert fired == []

    async def test_latest_run_not_interrupted_not_refired(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """反例：末次 run 非中断（真实失败 / 重派已建新 run）→ 不 fire。

        两条 run：旧 run=daemon_interrupted（60s 前），新 run 无 error_code
        （刚建）——「末次 run」判定不得被旧中断标记误触发。
        """
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.daemon import sweep as sweep_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-r3")
        rt = await _make_runtime(db_session, user.id, status="online")
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        now = datetime.now(UTC)
        await _make_run(
            db_session,
            worker.id,
            status="failed",
            error_code=DAEMON_INTERRUPTED_ERROR_CODE,
            created_at=now - timedelta(seconds=60),
        )
        await _make_run(db_session, worker.id, status="failed", error_code=None, created_at=now)

        await sweep_mod.session_offline_sweep_once(db_session)

        assert fired == []

    async def test_ended_at_beyond_grace_window_not_refired(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """反例：ended_at 超 worker_force_end 宽限（默认 30min）→ 不 fire
        （重派守卫③本身也会拒，预过滤避免无效任务与日志噪音）。"""
        from app.modules.agent import worker_redispatch as wr_mod
        from app.modules.daemon import sweep as sweep_mod

        fired: list[list[tuple[uuid.UUID, uuid.UUID]]] = []
        monkeypatch.setattr(wr_mod, "fire_worker_redispatch", lambda workers: fired.append(workers))
        user = await _make_user(db_session, prefix="wrk-r4")
        rt = await _make_runtime(db_session, user.id, status="online")
        parent = await _make_session(db_session, user.id, rt.id, status="ended", lease_id=None)
        worker = await _make_session(
            db_session,
            user.id,
            rt.id,
            status="failed",
            lease_id=None,
            parent_session_id=parent.id,
            role="worker",
        )
        worker.ended_at = datetime.now(UTC) - timedelta(minutes=45)
        db_session.add(worker)
        await db_session.commit()
        await _make_run(
            db_session, worker.id, status="failed", error_code=DAEMON_INTERRUPTED_ERROR_CODE
        )

        await sweep_mod.session_offline_sweep_once(db_session)

        assert fired == []
