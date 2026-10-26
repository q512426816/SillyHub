"""2026-10-09-stale-recheck-scope：复扫链范围 / daemon 活性门 / 循环韧性。

背景（2026-10-09 风险审查实证，源自 2026-10-08-backend-restart-fake-failed）：
原 ``_recheck_stale_runs_loop`` 是无界常驻 reaper——判死面覆盖全部 running 轮
且不看 daemon 活性，健康静默轮（等待用户应答/长工具调用）每 10 分钟被误杀
一次；循环体无异常处理，单次 DB 抖动整链永久死亡；FOR UPDATE 先于活性判定
加锁且循环末统一提交，与 daemon 收口路径形成周期性行锁竞争。

本文件钉新语义：
- 范围——只追 ``_deferred_run_ids`` 启动快照，未入集合的静默轮不被波及；
- 活性门——daemon 在线放行、确死判死、链路不可解析退回纯 recency；
- 韧性——单次迭代异常续链，连续失败超上限才放弃；
- 锁粒度——日志新鲜的活跃轮在启动清理全程零 FOR UPDATE。

fixture 模式参考 ``tests/modules/agent/test_stale_run_cleanup_liveness.py`` 与
``tests/modules/agent/test_quick_chat_ownership.py``（real-DB + 直接构造模型行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import Select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent import service as agent_service
from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.agent.service import STALE_RUN_ACTIVE_GRACE
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease


def _make_running_run() -> AgentRun:
    return AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        model="claude-sonnet-4",
        status="running",
        spec_strategy="interactive",
    )


async def _add_log(
    db_session: AsyncSession,
    run_id: uuid.UUID,
    age: timedelta,
    *,
    channel: str = "stdout",
    tool_kind: str | None = None,
) -> None:
    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel=channel,
            tool_kind=tool_kind,
            timestamp=datetime.now(UTC) - age,
            content_redacted="[TOOL_USE] bash: echo hi",
        )
    )
    await db_session.commit()


async def _make_daemon_chain(
    db_session: AsyncSession,
    *,
    run_id: uuid.UUID,
    daemon_status: str,
    heartbeat_age: timedelta,
    lease_updated_age: timedelta = timedelta(seconds=5),
) -> None:
    """构造 run → lease → runtime → daemon 实例链（对齐 patrol 解析路径）。

    lease_updated_age：最新 lease 的续约新鲜度——健康 run 由 daemon 每
    lease_heartbeat_interval（默认 5s）续约刷新 updated_at（2026-10-10
    -recheck-lease-freshness 对齐真实续约时序）；默认 5s = 续约中。
    """
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"recheck-{uid.hex[:8]}@example.com",
            password_hash="irrelevant",
            display_name="Recheck Owner",
            status="active",
        )
    )
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=uid,
        hostname=f"host-{uid.hex[:6]}",
        server_url="http://localhost:8000",
        status=daemon_status,
        last_heartbeat_at=datetime.now(UTC) - heartbeat_age,
    )
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        daemon_instance_id=instance.id,
        provider="claude_code",
        status=daemon_status,
        last_heartbeat_at=datetime.now(UTC) - heartbeat_age,
    )
    db_session.add_all([instance, runtime])
    db_session.add(
        DaemonTaskLease(
            id=uuid.uuid4(),
            agent_run_id=run_id,
            runtime_id=runtime.id,
            status="claimed",
            kind="interactive",
            created_at=datetime.now(UTC) - timedelta(hours=1),
            updated_at=datetime.now(UTC) - lease_updated_age,
        )
    )
    await db_session.commit()


# ── FR-01 范围 ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_deferred_run_ids_returns_only_recent(db_session: AsyncSession) -> None:
    """启动快照只收「日志宽限窗内」的 running 轮；停滞/无日志轮不入集合。"""
    run_recent = _make_running_run()
    run_stale = _make_running_run()
    run_silent = _make_running_run()
    db_session.add_all([run_recent, run_stale, run_silent])
    await db_session.commit()
    await _add_log(db_session, run_recent.id, timedelta(minutes=3))
    await _add_log(db_session, run_stale.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))

    deferred = await agent_service._deferred_run_ids(db_session)

    assert deferred == [run_recent.id]


@pytest.mark.asyncio
async def test_recheck_ignores_new_silent_run_outside_tracked_set(
    db_session: AsyncSession,
) -> None:
    """未入追踪集合的静默轮不被复扫波及（原实现对全部 running 轮判死）。"""
    tracked_run = _make_running_run()
    untracked_new_run = _make_running_run()
    db_session.add_all([tracked_run, untracked_new_run])
    await db_session.commit()
    # 追踪项：日志停滞 + 无 lease（链路不可解析 → 判死）；新开轮：同样静默无 lease
    await _add_log(db_session, tracked_run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))

    still = await agent_service._recheck_deferred_runs(db_session, {tracked_run.id})

    assert still == set()
    refreshed_tracked = await db_session.get(AgentRun, tracked_run.id)
    refreshed_new = await db_session.get(AgentRun, untracked_new_run.id)
    assert refreshed_tracked is not None
    assert refreshed_tracked.status == "failed"
    assert refreshed_tracked.error_code == "SERVICE_RESTART_INTERRUPTED"
    # 不在启动快照里的新开轮：零波及，保持 running
    assert refreshed_new is not None
    assert refreshed_new.status == "running"
    assert refreshed_new.error_code is None


# ── FR-02 daemon 活性门 ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_recheck_pardons_run_with_online_daemon(db_session: AsyncSession) -> None:
    """daemon 在线 + 日志停滞（等待用户应答/长工具调用的静默轮）→ 不判死。

    前提（2026-10-10-recheck-lease-freshness）：lease 续约新鲜（daemon 每
    5s 续约），证明 run 仍被 daemon 持有执行。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))
    await _make_daemon_chain(
        db_session, run_id=run.id, daemon_status="online", heartbeat_age=timedelta(minutes=1)
    )

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == {run.id}
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "running"
    assert refreshed.error_code is None
    assert refreshed.finished_at is None


@pytest.mark.asyncio
async def test_recheck_kills_run_with_online_daemon_but_stale_lease(
    db_session: AsyncSession,
) -> None:
    """实例在线但 lease 续约停滞 → 判死出列（2026-10-10-recheck-lease-freshness）。

    场景：daemon 进程重启丢失 run 执行状态后实例重新上线——日志停滞 +
    实例 online，但该 run 的 lease 不再续约（daemon 重启后不会为旧 run
    心跳）。原实现只看实例 online 即豁免 → run 永卡 running（patrol 对
    online 实例同样豁免，无第二兜底）。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))
    await _make_daemon_chain(
        db_session,
        run_id=run.id,
        daemon_status="online",
        heartbeat_age=timedelta(minutes=1),
        lease_updated_age=timedelta(hours=1),
    )

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == set()
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"


@pytest.mark.asyncio
async def test_recheck_kills_silent_run_with_dead_daemon(db_session: AsyncSession) -> None:
    """daemon 明确离线且心跳停滞超宽限窗 + 日志停滞 → 判死并出列。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))
    await _make_daemon_chain(
        db_session,
        run_id=run.id,
        daemon_status="offline",
        heartbeat_age=STALE_RUN_ACTIVE_GRACE + timedelta(minutes=30),
    )

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == set()
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"
    assert refreshed.exit_code == -1


@pytest.mark.asyncio
async def test_recheck_unresolvable_daemon_falls_back_to_recency(
    db_session: AsyncSession,
) -> None:
    """run→daemon 链路不可解析（无 lease）→ 退回纯 recency 判死，防永卡兜底不缩小。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    await _add_log(db_session, run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == set()
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"


# ── 2026-10-26-session-stage-progress task-06（FR-07 / D-014）askwait 豁免 ──


@pytest.mark.asyncio
async def test_recheck_pardons_awaiting_user_input_run_without_lease(
    db_session: AsyncSession,
) -> None:
    """生产实证复刻（会话 388bb823 / run 3b601319）：AskUserQuestion 等待用户
    回答的轮（最后 ask 信号晚于最后 user_input）+ 无 lease（对话轮 lease 为
    会话级绑定，inject 注入轮按 run 维度查无 lease，活性门返回 None）+ 日志
    停滞超宽限窗 → 豁免判死，保持追踪等真终态。与启动清理 askwait 豁免
    （2026-10-12-stale-run-askwait-fix）同函数同上限，补齐复扫链盲区。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    # 用户发消息（-2h）→ agent 提问后等待回答（-18min，停滞 18 分钟 > 宽限窗 10 分钟）
    await _add_log(db_session, run.id, timedelta(hours=2), channel="user_input")
    await _add_log(
        db_session,
        run.id,
        STALE_RUN_ACTIVE_GRACE + timedelta(minutes=8),
        channel="tool_call",
        tool_kind="ask",
    )

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == {run.id}
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "running"
    assert refreshed.error_code is None
    assert refreshed.finished_at is None


@pytest.mark.asyncio
async def test_recheck_still_kills_awaiting_user_input_past_24h(
    db_session: AsyncSession,
) -> None:
    """askwait 豁免受 24h 上限约束（_ASKWAIT_EXEMPT_MAX_AGE）：最后 ask 距今
    超龄 → 回落既有判死路径（防 daemon 真死 + 提问未答 run 永卡 running，
    与启动清理同款权衡）。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    # ask 距今 24h5m（超 24h 上限），user_input 更早（-25h）
    await _add_log(db_session, run.id, timedelta(hours=25), channel="user_input")
    await _add_log(
        db_session,
        run.id,
        timedelta(hours=24, minutes=5),
        channel="tool_call",
        tool_kind="ask",
    )

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == set()
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"


@pytest.mark.asyncio
async def test_recheck_still_kills_when_user_input_after_ask(
    db_session: AsyncSession,
) -> None:
    """最后 user_input 晚于最后 ask（用户已回答、回答后静默）→ askwait 不命中，
    判死照旧——豁免只保护「未回答的等待」，不保护已回答后的真死静默。"""
    run = _make_running_run()
    db_session.add(run)
    await db_session.commit()
    # agent 提问（-30min）→ 用户回答（-15min，最后日志，停滞 15 分钟 > 宽限窗）
    await _add_log(
        db_session,
        run.id,
        STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20),
        channel="tool_call",
        tool_kind="ask",
    )
    await _add_log(db_session, run.id, timedelta(minutes=15), channel="user_input")

    still = await agent_service._recheck_deferred_runs(db_session, {run.id})

    assert still == set()
    refreshed = await db_session.get(AgentRun, run.id)
    assert refreshed is not None
    assert refreshed.status == "failed"
    assert refreshed.error_code == "SERVICE_RESTART_INTERRUPTED"


# ── FR-03 循环韧性 ────────────────────────────────────────────────────────


class _FakeSessionCtx:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *args: object) -> bool:
        return False


async def test_recheck_loop_survives_transient_error() -> None:
    """首轮迭代抛异常 → 链不终止，第二轮正常收敛后退出。"""
    attempts: list[set] = []

    async def _fake_recheck(session: object, tracked: set) -> set:
        attempts.append(tracked)
        if len(attempts) == 1:
            raise RuntimeError("transient db error")
        return set()

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(agent_service, "STALE_RUN_ACTIVE_GRACE", timedelta(0))
        mp.setattr(agent_service, "get_session_factory", lambda: _FakeSessionCtx)
        mp.setattr(agent_service, "_recheck_deferred_runs", _fake_recheck)
        await agent_service._recheck_stale_runs_loop([uuid.uuid4()])

    assert len(attempts) == 2


async def test_recheck_loop_gives_up_after_consecutive_errors() -> None:
    """持续失败 → 恰好在连续失败上限处放弃（不外溢异常）。"""
    attempts: list[int] = []

    async def _always_fail(session: object, tracked: set) -> set:
        attempts.append(1)
        raise RuntimeError("persistent db error")

    with pytest.MonkeyPatch.context() as mp:
        mp.setattr(agent_service, "STALE_RUN_ACTIVE_GRACE", timedelta(0))
        mp.setattr(agent_service, "get_session_factory", lambda: _FakeSessionCtx)
        mp.setattr(agent_service, "_recheck_deferred_runs", _always_fail)
        await agent_service._recheck_stale_runs_loop([uuid.uuid4()])

    assert len(attempts) == agent_service._RECHECK_MAX_CONSECUTIVE_ERRORS


# ── FR-04 锁粒度 ─────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_cleanup_skips_recent_run_without_lock(db_session: AsyncSession) -> None:
    """日志新鲜的活跃轮在启动清理全程零 FOR UPDATE（判活前移、先判后锁）。"""
    recent_run = _make_running_run()
    stale_run = _make_running_run()
    db_session.add_all([recent_run, stale_run])
    await db_session.commit()
    await _add_log(db_session, recent_run.id, timedelta(minutes=3))
    await _add_log(db_session, stale_run.id, STALE_RUN_ACTIVE_GRACE + timedelta(minutes=20))

    select_statements: list[Select] = []
    original_execute = db_session.execute

    async def _spy_execute(statement: object, *args: object, **kwargs: object):
        if isinstance(statement, Select):
            select_statements.append(statement)
        return await original_execute(statement, *args, **kwargs)

    # 2026-10-26 提交门既有红修复：两处 type: ignore 在单文件显式传参 mypy 下判
    # unused（_spy_execute 全 object 签名对 execute 重载天然兼容）——删除；全仓
    # mypy app 不扫 tests/ 故此前未暴露，CI/hook 单文件面才报。
    db_session.execute = _spy_execute
    try:
        cleaned = await agent_service._cleanup_stale_runs_impl(db_session)
    finally:
        del db_session.execute

    assert cleaned == 1
    locked_selects = [
        s for s in select_statements if getattr(s, "_for_update_arg", None) is not None
    ]
    # 全程只有 stale 轮走了一次行锁（单轮一次 FOR UPDATE）；活跃轮零锁面
    assert len(locked_selects) == 1
    assert "agent_runs" in str(locked_selects[0])
    refreshed_recent = await db_session.get(AgentRun, recent_run.id)
    assert refreshed_recent is not None
    assert refreshed_recent.status == "running"
