"""Tests for DaemonService.recover_session_after_daemon_restart (task-10).

Covers FR-08 / D-003@v1 daemon-restart recovery reconciliation:
  - session/lease/runtime/provider ownership match → status=reconnecting,
    interrupted currentRun converged to failed (daemon_restarted).
  - interrupted_run_id already terminal → idempotent (keeps completion result).
  - interrupted_run_id belonging to another session → invariant violation.
  - another non-terminal run on same session (besides interrupted_run_id) →
    invariant violation.
  - session already ended/failed → returns terminal, not resurrected.
  - runtime/lease/provider mismatch → rejected.
  - token rotation: lease claim_token rotated on successful recover (防旧 claim 重放).

SQLite ignores FOR UPDATE; the row-lock query + ownership branches are still
exercised (PostgreSQL concurrency proof is environment-gated, see report).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import USER_INPUT_LOG_MAX_CHARS, AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import (
    DaemonService,
    DaemonSessionInvariantViolation,
)

# ── Fixtures ─────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"rec-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


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


def _mock_redis() -> AsyncMock:
    redis = AsyncMock()
    redis.publish = AsyncMock()
    return redis


@pytest.fixture()
def mocked_redis():
    redis = _mock_redis()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _make_active_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "active",
    agent_session_id_sdk: str = "sdk-sess-1",
    current_run_status: str | None = "running",
    claim_token: str = "old-token",
) -> tuple[AgentSession, AgentRun, DaemonTaskLease]:
    """Build a session + run + interactive lease triple directly in the DB."""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime.id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=now,
        metadata_={"claim_token": claim_token},
    )
    db_session.add(lease)
    await db_session.flush()

    session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime.id,
        lease_id=lease.id,
        provider="claude",
        status=session_status,
        agent_session_id=agent_session_id_sdk,
        config={"manual_approval": False},
        turn_count=1,
        created_at=now,
        last_active_at=now,
        cwd="C:\\work",
    )
    db_session.add(session)
    await db_session.flush()

    run: AgentRun | None = None
    if current_run_status is not None:
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status=current_run_status,
            spec_strategy="interactive",
            agent_session_id=session.id,
        )
        db_session.add(run)
        await db_session.flush()

    await db_session.commit()
    await db_session.refresh(lease)
    await db_session.refresh(session)
    if run is not None:
        await db_session.refresh(run)
    return session, run, lease  # type: ignore[return-value]


# ── recover_session_after_daemon_restart ──────────────────────────────────────


class TestRecoverSessionAfterDaemonRestart:
    @pytest.mark.asyncio
    async def test_ownership_match_active_with_running_run_converges(
        self, db_session, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )

        assert result.status == "reconnecting"
        assert result.interrupted_run_status == "failed"
        await db_session.refresh(session)
        await db_session.refresh(run)
        await db_session.refresh(lease)
        assert session.status == "reconnecting"
        assert run.status == "failed"
        assert run.error_code == "daemon_restarted"
        assert run.finished_at is not None

    @pytest.mark.asyncio
    async def test_active_no_current_run_writes_reconnecting_only(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 7: crashed while idle (no running run) — no fake run created."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )

        assert result.status == "reconnecting"
        assert result.interrupted_run_status is None
        await db_session.refresh(session)
        assert session.status == "reconnecting"

    @pytest.mark.asyncio
    async def test_interrupted_run_already_terminal_keeps_result(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 11: run already completed before crash — idempotent."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="completed",
        )
        run.output_redacted = "done-content"
        db_session.add(run)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )

        # session 仍可继续恢复（reconnecting），run 保持 completed（幂等不改）。
        assert result.status == "reconnecting"
        await db_session.refresh(run)
        assert run.status == "completed"
        assert run.output_redacted == "done-content"

    @pytest.mark.asyncio
    async def test_interrupted_run_belongs_to_other_session_invariant(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 10: interrupted_run_id points to another session → 409."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session_a, _run_a, lease_a = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status=None
        )
        _session_b, run_b, _lease_b = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            agent_session_id_sdk="sdk-sess-2",
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.recover_session_after_daemon_restart(
                session_a.id,
                runtime_id=rt.id,
                lease_id=lease_a.id,
                provider="claude",
                agent_session_id="sdk-sess-1",
                interrupted_run_id=run_b.id,  # belongs to session_b
            )

    @pytest.mark.asyncio
    async def test_another_nonterminal_run_on_same_session_invariant(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary: interrupted_run_id given but another non-terminal run exists."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run_a, lease = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status="running"
        )
        # second non-terminal run on same session (violates 1-active invariant).
        run_b = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session.id,
        )
        db_session.add(run_b)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionInvariantViolation):
            await svc.recover_session_after_daemon_restart(
                session.id,
                runtime_id=rt.id,
                lease_id=lease.id,
                provider="claude",
                agent_session_id="sdk-sess-1",
                interrupted_run_id=run_a.id,
            )

    @pytest.mark.asyncio
    async def test_session_already_ended_returns_ended_no_resurrect(
        self, db_session, mocked_redis
    ) -> None:
        """Boundary 8: session already ended → return ended, no run convergence."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            session_status="ended",
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "ended"

    @pytest.mark.asyncio
    async def test_session_already_failed_returns_failed(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            session_status="failed",
            current_run_status=None,
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "failed"

    @pytest.mark.asyncio
    async def test_runtime_mismatch_rejected(self, db_session, mocked_redis) -> None:
        """Boundary 9: runtime_id mismatch → rejected."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, _run, lease = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status=None
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=uuid.uuid4(),  # mismatched
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_lease_kind_not_interactive_rejected(self, db_session, mocked_redis) -> None:
        """FR-09 守门：batch lease 不进 recover（rejected）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        # Build a session bound to a BATCH lease (shouldn't happen, but guard).
        now = datetime.now(UTC)
        batch_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            status="claimed",
            kind="batch",
            claimed_at=now,
            lease_expires_at=now,
            metadata_={"claim_token": "x"},
        )
        db_session.add(batch_lease)
        await db_session.flush()
        session = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            status="active",
            agent_session_id="sdk-sess-1",
            turn_count=1,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(session)
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=batch_lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_token_rotated_on_successful_recover(self, db_session, mocked_redis) -> None:
        """防旧 claim 重放：recover 成功旋转 lease.claim_token（new value != old）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            claim_token="old-secret-token",
        )

        svc = DaemonService(db_session)
        await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )
        await db_session.refresh(lease)
        new_token = (lease.metadata_ or {}).get("claim_token")
        assert new_token is not None
        assert new_token != "old-secret-token"

    @pytest.mark.asyncio
    async def test_session_not_found_returns_rejected(self, db_session, mocked_redis) -> None:
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            uuid.uuid4(),
            runtime_id=rt.id,
            lease_id=uuid.uuid4(),
            provider="claude",
            agent_session_id="x",
            interrupted_run_id=None,
        )
        assert result.status == "rejected"

    @pytest.mark.asyncio
    async def test_session_in_reconnecting_idempotent_re_recover(
        self, db_session, mocked_redis
    ) -> None:
        """Idempotent re-recover: already reconnecting → stay reconnecting, converge run."""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session,
            user_id=uid,
            runtime=rt,
            current_run_status="running",
            session_status="reconnecting",
        )

        svc = DaemonService(db_session)
        result = await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id="sdk-sess-1",
            interrupted_run_id=run.id,
        )
        assert result.status == "reconnecting"
        await db_session.refresh(run)
        assert run.status == "failed"


# ── 2026-09-10-auto-resume-interrupted-turn：自动续跑入队守卫矩阵 ────────────────


async def _add_user_input_log(db_session: AsyncSession, run_id: uuid.UUID, content: str) -> None:
    from app.modules.agent.model import AgentRunLog

    db_session.add(
        AgentRunLog(
            run_id=run_id,
            channel="user_input",
            content_redacted=content,
            timestamp=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _queued_rows(db_session: AsyncSession, session_id: uuid.UUID) -> list:
    from sqlalchemy import select

    from app.modules.agent.model import AgentSessionQueuedMessage

    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage)
                .where(AgentSessionQueuedMessage.agent_session_id == session_id)
                .order_by(AgentSessionQueuedMessage.position)
                .execution_options(populate_existing=True)
            )
        ).scalars()
    )


class TestAutoResumeEnqueue:
    """recover 事务内的自动续跑入队（design §6 矩阵，G10 归 queue 侧另测）。"""

    async def _recover(self, db_session, rt, lease, session, run):
        svc = DaemonService(db_session)
        return await svc.recover_session_after_daemon_restart(
            session.id,
            runtime_id=rt.id,
            lease_id=lease.id,
            provider="claude",
            agent_session_id=session.agent_session_id or "sdk-sess-1",
            interrupted_run_id=run.id,
        )

    @pytest.mark.asyncio
    async def test_happy_path_enqueues_wrapped_prompt_head_of_queue(
        self, db_session, mocked_redis
    ) -> None:
        """守卫全过：入队续跑条目（包装头+原文、origin 复合值、pending、队首 -1）。"""
        from app.modules.daemon.session.service.auto_resume import (
            RESUME_PROMPT_TEMPLATE,
            make_auto_resume_origin,
        )

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, run.id, "继续重构登录模块")

        result = await self._recover(db_session, rt, lease, session, run)

        assert result.status == "reconnecting"
        rows = await _queued_rows(db_session, session.id)
        assert len(rows) == 1
        row = rows[0]
        assert row.status == "pending"
        assert row.origin == make_auto_resume_origin(run.id)
        assert "继续重构登录模块" in row.prompt
        assert row.prompt.startswith("[系统续跑提示]")
        assert "{ORIGINAL_PROMPT}" not in row.prompt
        assert RESUME_PROMPT_TEMPLATE.split("{ORIGINAL_PROMPT}")[0] in row.prompt
        assert row.position == -1  # 空队列队首（MIN(空)=0 → -1）

    @pytest.mark.asyncio
    async def test_g1_scope_worker_and_shadow_skip(self, db_session, mocked_redis) -> None:
        """反例：worker（parent 非空）与影子（kind=group_member）不入队。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        # worker 形态：parent_session_id 指向另一会话。
        main, _main_run, _ = await _make_active_session(db_session, user_id=uid, runtime=rt)
        worker, worker_run, wlease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        worker.parent_session_id = main.id
        await db_session.commit()
        await _add_user_input_log(db_session, worker_run.id, "子任务")
        assert (
            await self._recover(db_session, rt, wlease, worker, worker_run)
        ).status == "reconnecting"
        assert await _queued_rows(db_session, worker.id) == []

        # 影子形态：session_kind=group_member。
        shadow, shadow_run, slease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        shadow.session_kind = "group_member"
        await db_session.commit()
        await _add_user_input_log(db_session, shadow_run.id, "群成员轮")
        await self._recover(db_session, rt, slease, shadow, shadow_run)
        assert await _queued_rows(db_session, shadow.id) == []

    @pytest.mark.asyncio
    async def test_g2_config_disabled_skip(self, db_session, mocked_redis) -> None:
        """反例：config 显式 False 不入队（缺省开已在 happy path 覆盖）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        session.config = {"manual_approval": False, "auto_resume_interrupted": False}
        await db_session.commit()
        await _add_user_input_log(db_session, run.id, "x")
        await self._recover(db_session, rt, lease, session, run)
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    async def test_g3_terminal_run_keeps_no_resume(self, db_session, mocked_redis) -> None:
        """反例：中断 run 已 completed（幂等保留终态，error_code 非 daemon_restarted）不入队。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(
            db_session, user_id=uid, runtime=rt, current_run_status="completed"
        )
        await _add_user_input_log(db_session, run.id, "x")
        result = await self._recover(db_session, rt, lease, session, run)
        assert result.interrupted_run_status is None
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    async def test_g4_not_latest_run_skip(self, db_session, mocked_redis) -> None:
        """反例：中断 run 之后已有更新 run（用户手发）不入队。"""
        from datetime import timedelta

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, run.id, "x")
        # 更新 run 已终态（用户已手动重发并跑完）——不触发不变式（活跃 run
        # 唯一性），但 G4 判定中断轮非最新 → 不自动。
        db_session.add(
            AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider="claude",
                status="completed",
                spec_strategy="interactive",
                agent_session_id=session.id,
                created_at=datetime.now(UTC) + timedelta(seconds=5),
            )
        )
        await db_session.commit()
        result = await self._recover(db_session, rt, lease, session, run)
        assert result.status == "reconnecting"
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "content",
        ["", "x" * USER_INPUT_LOG_MAX_CHARS],
        ids=["no-input", "truncated-at-limit"],
    )
    async def test_g5_missing_or_truncated_input_skip(
        self, db_session, mocked_redis, content: str
    ) -> None:
        """反例：无 user_input / 长度触截断上限（二次包装退化）不入队。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        if content:
            await _add_user_input_log(db_session, run.id, content)
        await self._recover(db_session, rt, lease, session, run)
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    async def test_g6_attachment_marker_skip(self, db_session, mocked_redis) -> None:
        """反例：输入含附件标记行（宽松前缀，kind 任意）不入队。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        marker = f"[附件:{uuid.uuid4()}|image|shot.png]"
        await _add_user_input_log(db_session, run.id, marker + "\n看一下截图")
        await self._recover(db_session, rt, lease, session, run)
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    async def test_g7_chain_limit_two(self, db_session, mocked_redis) -> None:
        """链上限：深度 1 仍自动；深度 2（第 3 次中断）不再自动。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        # 深度 1：中断轮自身是续跑轮（metadata 指向源），源非续跑 → 仍入队。
        src_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=uuid.uuid4(),
        )
        db_session.add(src_run)
        await db_session.flush()
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        run.metadata_ = {"auto_resume_of": str(src_run.id)}
        await db_session.commit()
        await _add_user_input_log(db_session, run.id, "第二次中断")
        await self._recover(db_session, rt, lease, session, run)
        assert len(await _queued_rows(db_session, session.id)) == 1

        # 深度 2：源也是续跑轮 → 不再自动。
        session2, run2, lease2 = await _make_active_session(db_session, user_id=uid, runtime=rt)
        src2 = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=session2.id,
        )
        db_session.add(src2)
        await db_session.flush()
        src2.metadata_ = {"auto_resume_of": str(src_run.id)}
        run2.metadata_ = {"auto_resume_of": str(src2.id)}
        await db_session.commit()
        await _add_user_input_log(db_session, run2.id, "第三次中断")
        await self._recover(db_session, rt, lease2, session2, run2)
        assert await _queued_rows(db_session, session2.id) == []

    @pytest.mark.asyncio
    async def test_g8_recover_retry_idempotent(self, db_session, mocked_redis) -> None:
        """幂等：recover 网络重入（第二次调用）不重复入队。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, run.id, "x")

        first = await self._recover(db_session, rt, lease, session, run)
        assert first.status == "reconnecting"
        second = await self._recover(db_session, rt, lease, session, run)
        assert second.status == "reconnecting"
        rows = await _queued_rows(db_session, session.id)
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_g9_cancelled_dialog_skip(self, db_session, mocked_redis) -> None:
        """反例：中断时挂被取消 pending dialog 的轮（断点=等回答）不入队。"""
        from app.modules.daemon.model import SessionDialogRequest

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, run.id, "x")
        db_session.add(
            SessionDialogRequest(
                session_id=session.id,
                run_id=run.id,
                request_id=f"dlg-{uuid.uuid4()}",
                tool_name="AskUserQuestion",
                dialog_kind="ask_user_question",
                dialog_payload={"question": "选哪个？", "options": []},
                status="cancelled",
            )
        )
        await db_session.commit()
        await self._recover(db_session, rt, lease, session, run)
        assert await _queued_rows(db_session, session.id) == []

    @pytest.mark.asyncio
    async def test_g10_queue_full_skip_and_head_position(self, db_session, mocked_redis) -> None:
        """满员反例 + 队首正例：满 5 条不入队；未满时新条目 position=MIN-1 队首。"""
        from app.modules.agent.model import AgentSessionQueuedMessage

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        # 满员（5 条 pending）→ 不入队。
        full, full_run, fl = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, full_run.id, "x")
        for i in range(5):
            db_session.add(
                AgentSessionQueuedMessage(
                    agent_session_id=full.id,
                    sender_user_id=uid,
                    prompt=f"q{i}",
                    status="pending",
                    position=i,
                )
            )
        await db_session.commit()
        await self._recover(db_session, rt, fl, full, full_run)
        assert len(await _queued_rows(db_session, full.id)) == 5

        # 未满（2 条既有 pending）→ 入队且队首（position=0-1=-1）。
        part, part_run, pl = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, part_run.id, "续跑这条")
        for i in range(2):
            db_session.add(
                AgentSessionQueuedMessage(
                    agent_session_id=part.id,
                    sender_user_id=uid,
                    prompt=f"p{i}",
                    status="pending",
                    position=i,
                )
            )
        await db_session.commit()
        await self._recover(db_session, rt, pl, part, part_run)
        rows = await _queued_rows(db_session, part.id)
        assert len(rows) == 3
        assert rows[0].origin is not None and rows[0].origin.startswith("auto_resume:")
        assert rows[0].position == -1
        assert "续跑这条" in rows[0].prompt

    @pytest.mark.asyncio
    async def test_savepoint_failure_keeps_recovery_alive(self, db_session, mocked_redis) -> None:
        """SAVEPOINT：入队段抛错（注入）→ 弃续跑保恢复主链（session 仍 reconnecting、无残留队列行）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        session, run, lease = await _make_active_session(db_session, user_id=uid, runtime=rt)
        await _add_user_input_log(db_session, run.id, "x")

        with patch(
            "app.modules.daemon.session.service.auto_resume.wrap_resume_prompt",
            side_effect=RuntimeError("injected"),
        ):
            result = await self._recover(db_session, rt, lease, session, run)

        assert result.status == "reconnecting"
        assert await _queued_rows(db_session, session.id) == []
