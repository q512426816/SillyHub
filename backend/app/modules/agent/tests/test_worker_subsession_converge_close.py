"""task-10（2026-08-25-team-subsession-governance）：converge 沿树批量 end_session 单测。

design §5.D / FR-06 / 生命周期契约表 converge 行：

- converge 成功路径（R5 ``converged_at`` 原子抢占命中 + finalize 无
  pending_conflicts——execute 全 merged 分支与 bootstrap 分支均算）沿
  ``mission_worker_sessions`` 一层枚举分身子会话，逐个复用
  ``SessionService.end_session`` 既有链收口：子会话 ended + interactive lease
  completed + P0-2 SESSION_END WS 下发；
- best-effort：单个收口失败（lease 绑定异常等）log.warning 继续下一个，
  不影响其余分身收口、converge 返回值与 converged_at 置位（孤儿由 task-12
  patrol 兜底）；
- 零收口三分支：converge_explicit 冲突回滚（converged_at 还原 NULL）、
  needs_manual（mcp_tools 冲突状态机超限，置位已被回滚）、finalize 异常回滚
  （BE-P1-3）——子会话全部保持活跃供解冲突参考（design §5.D 铁律）；
- 存量 mission（无子会话）零行为变化：收口枚举空集 no-op（FR-09）。

测试隔离策略：monkeypatch ``ws_hub.get_daemon_ws_hub`` 为录音 hub 断言 WS 下发
（同 test_worker_subsession_control 模式）；merge 结果经 monkeypatch
``FinalizerService.finalize_execute_mission`` 控返回（隔离 daemon RPC），
无 worktree_branch 行时真实实现自然早退返空（bootstrap 路径不需要 mock）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.modules.agent.finalizer import (
    FinalizerMergeResult,
    FinalizerService,
    converge_mission_for_completed_run,
)
from app.modules.agent.mcp_tools import converge_mission
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_END
from app.modules.workspace.model import Workspace

# ── 播种 helpers ─────────────────────────────────────────────────────────────


def _plain_request() -> Request:
    """无 X-Session-Id 的直调 Request（converge_mission 端点直调形态）。"""
    return Request({"type": "http", "headers": []})


async def _seed_tree(
    db: AsyncSession, *, constraints: dict | None = None
) -> tuple[Workspace, AgentSession, AgentMission, uuid.UUID, DaemonRuntime, AgentRun]:
    """建 user + workspace + 主控根会话 + 会话 mission（created_by=user）+ 在线
    runtime + orchestrator 锚点 run（converge_explicit 入口的 run 锚）。"""
    user_id = uuid.uuid4()
    db.add(
        User(
            id=user_id,
            email=f"tcc-{user_id.hex[:10]}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    db.add(ws)
    root = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude",
        status="active",
    )
    db.add(root)
    await db.commit()

    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        session_id=root.id,
        created_by=user_id,
        constraints=constraints,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"rt-{user_id.hex[:6]}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    anchor = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role="orchestrator",
        agent_session_id=root.id,
        objective="主控",
    )
    db.add(anchor)
    await db.commit()
    await db.refresh(anchor)
    return ws, root, mission, user_id, rt, anchor


async def _seed_worker(
    db: AsyncSession,
    root: AgentSession,
    mission: AgentMission,
    *,
    owner_id: uuid.UUID,
    runtime: DaemonRuntime,
    session_status: str = "active",
    lease_kind: str = "interactive",
    worker_done_at: datetime | None = None,
) -> tuple[AgentSession, DaemonTaskLease]:
    """建分身子会话（parent 挂根、owner=mission 创建者 D-004）+ interactive
    lease + 首 run（mission_id+role 双标记，completed）。"""
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
        worker_done_at=worker_done_at,
        lease_id=lease.id,
        runtime_id=runtime.id,
    )
    db.add(worker)
    first_run = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        provider="claude",
        status="completed",
        role="impl",
        agent_session_id=worker.id,
        objective="分身任务",
    )
    db.add(first_run)
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


def _patch_finalize(
    monkeypatch: pytest.MonkeyPatch,
    *,
    merged_branches: list[str] | None = None,
    pending_conflicts: list[dict] | None = None,
    raise_exc: Exception | None = None,
) -> None:
    """控 ``FinalizerService.finalize_execute_mission`` 返回（隔离 daemon RPC）。"""

    async def _fake_finalize(self: FinalizerService, mission_id: uuid.UUID) -> FinalizerMergeResult:
        if raise_exc is not None:
            raise raise_exc
        return FinalizerMergeResult(
            merged_branches=merged_branches or [],
            pending_conflicts=pending_conflicts or [],
        )

    monkeypatch.setattr(FinalizerService, "finalize_execute_mission", _fake_finalize)


# ── 1. converge 成功路径：沿树全收口 ─────────────────────────────────────────


class TestConvergeSuccessClosesTree:
    async def test_execute_merge_success_ends_all_workers(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """execute 全 merged（无 pending_conflicts，BE-P1-4b cleanup 后）→ 全分身
        收口：子会话 ended + lease completed + SESSION_END 逐个下发。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        w1, l1 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        w2, l2 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        _patch_finalize(monkeypatch, merged_branches=["workers/aaa"])

        status = await converge_mission_for_completed_run(
            db_session, anchor.id, None, converge_explicit=True
        )

        assert status == "done"
        await db_session.refresh(mission)
        assert mission.converged_at is not None, "收口不应影响 converged_at 置位"
        # 全分身收口：子会话 ended + interactive lease completed
        for worker, lease in ((w1, l1), (w2, l2)):
            await db_session.refresh(worker)
            assert worker.status == "ended"
            await db_session.refresh(lease)
            assert lease.status == "completed"
        # SESSION_END 逐个下发（P0-2 链），payload 携对应 session/lease
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w1.id), str(w2.id)}
        assert {p["lease_id"] for p in ends} == {str(l1.id), str(l2.id)}

    async def test_bootstrap_success_ends_all_workers_idempotent(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """bootstrap 分支（finalize_bootstrap_mission 后，无 mock 走真实链）→
        全收口；已 ended 分身经 end_session 幂等早退（不重发 SESSION_END、
        不动 lease）。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        w1, l1 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        w2, l2 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        w3, l3 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            session_status="ended",
            worker_done_at=datetime.now(UTC),
        )

        status = await converge_mission_for_completed_run(
            db_session, anchor.id, None, converge_explicit=True
        )

        assert status == "done"
        await db_session.refresh(mission)
        assert mission.converged_at is not None
        for worker, lease in ((w1, l1), (w2, l2)):
            await db_session.refresh(worker)
            assert worker.status == "ended"
            await db_session.refresh(lease)
            assert lease.status == "completed"
        # w3 已 ended：幂等早退（保持 ended、lease 不被改写、不重发 WS）
        await db_session.refresh(w3)
        assert w3.status == "ended"
        await db_session.refresh(l3)
        assert l3.status == "claimed"
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w1.id), str(w2.id)}

    async def test_partial_end_failure_best_effort(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """单个分身 end 失败（lease 绑定异常）→ log.warning 继续其余分身；
        converge 返回值与 converged_at 置位不受影响。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        w1, _l1 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        # w2：lease kind=batch → end_session 抛 DaemonSessionInvariantViolation
        w2, _l2 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            lease_kind="batch",
            worker_done_at=datetime.now(UTC),
        )
        w3, l3 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )

        status = await converge_mission_for_completed_run(
            db_session, anchor.id, None, converge_explicit=True
        )

        assert status == "done", "单个收口失败不影响 converge 返回值"
        await db_session.refresh(mission)
        assert mission.converged_at is not None, "单个收口失败不影响置位"
        await db_session.refresh(w1)
        assert w1.status == "ended"
        await db_session.refresh(w3)
        assert w3.status == "ended"
        await db_session.refresh(l3)
        assert l3.status == "completed"
        await db_session.refresh(w2)
        assert w2.status == "active", "失败分身保持活跃（孤儿由 task-12 patrol 兜底）"
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w1.id), str(w3.id)}


# ── 2. 零收口三分支：冲突回滚 / needs_manual / 异常回滚 ───────────────────────


class TestConvergeFailureKeepsWorkersActive:
    async def test_conflict_rollback_keeps_workers_active(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """converge_explicit 冲突（pending_conflicts 非空）→ converged_at 回滚
        NULL，零收口——子会话保持活跃供解冲突参考（design §5.D）。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        workers: list[AgentSession] = []
        for _ in range(2):
            w, _lease = await _seed_worker(
                db_session,
                root,
                mission,
                owner_id=user_id,
                runtime=rt,
                worker_done_at=datetime.now(UTC),
            )
            workers.append(w)
        _patch_finalize(
            monkeypatch,
            pending_conflicts=[{"file": "src/a.py", "marker_lines": [5], "branch": "workers/aaa"}],
        )

        status = await converge_mission_for_completed_run(
            db_session, anchor.id, None, converge_explicit=True
        )

        # 置位已被回滚（返回值是抢占后重派生的状态透传，非收敛成功标志）
        assert status == "done"
        await db_session.refresh(mission)
        assert mission.converged_at is None, "冲突路径置位必须回滚 NULL"
        for w in workers:
            await db_session.refresh(w)
            assert w.status == "active", "冲突路径分身必须保持活跃"
        assert _session_ends(captured) == [], "冲突路径零 SESSION_END"

    async def test_needs_manual_keeps_workers_active(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """MCP converge 状态机 R-07 超限 → needs_manual：置位已被入口冲突回滚，
        分身零收口（真实 converge_mission_for_completed_run 全链，仅 mock
        finalize 返回与 GLM）。"""
        captured = _recording_ws_hub(monkeypatch)
        ws, root, mission, user_id, rt, _anchor = await _seed_tree(
            db_session, constraints={"conflict_attempts": 3}
        )
        workers: list[AgentSession] = []
        for _ in range(2):
            w, _lease = await _seed_worker(
                db_session,
                root,
                mission,
                owner_id=user_id,
                runtime=rt,
                worker_done_at=datetime.now(UTC),
            )
            workers.append(w)
        _patch_finalize(
            monkeypatch,
            pending_conflicts=[{"file": "src/b.py", "marker_lines": [9], "branch": "workers/bbb"}],
        )
        from app.modules.agent import delegation

        class _FakeGLMConfig:
            @staticmethod
            def from_env():
                return None

        monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)

        resp = await converge_mission(ws.id, mission.id, _plain_request(), db_session, None)

        assert resp.status == "needs_manual"
        assert resp.converged is False
        await db_session.refresh(mission)
        assert mission.converged_at is None, "needs_manual 路径置位已被冲突回滚"
        for w in workers:
            await db_session.refresh(w)
            assert w.status == "active", "needs_manual 路径分身必须保持活跃"
        assert _session_ends(captured) == [], "needs_manual 路径零 SESSION_END"

    async def test_finalize_exception_rollback_keeps_workers_active(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """finalize 异常（BE-P1-3）→ converged_at 回滚 NULL + 异常上抛，零收口。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        workers: list[AgentSession] = []
        for _ in range(2):
            w, _lease = await _seed_worker(
                db_session,
                root,
                mission,
                owner_id=user_id,
                runtime=rt,
                worker_done_at=datetime.now(UTC),
            )
            workers.append(w)
        _patch_finalize(monkeypatch, raise_exc=RuntimeError("git rpc boom"))

        with pytest.raises(RuntimeError, match="git rpc boom"):
            await converge_mission_for_completed_run(
                db_session, anchor.id, None, converge_explicit=True
            )

        await db_session.refresh(mission)
        assert mission.converged_at is None, "异常回滚路径置位必须还原 NULL"
        for w in workers:
            await db_session.refresh(w)
            assert w.status == "active", "异常回滚路径分身必须保持活跃"
        assert _session_ends(captured) == [], "异常回滚路径零 SESSION_END"


# ── 3. 存量 mission（无子会话）零行为变化（FR-09）────────────────────────────


class TestLegacyMissionNoSubsessions:
    async def test_legacy_mission_converge_noop_close(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """存量 batch 形态 mission（session_id=None、无子会话）非显式自动收敛：
        行为零变化——收口枚举空集 no-op，零 WS 下发。"""
        captured = _recording_ws_hub(monkeypatch)
        mission = AgentMission(
            workspace_id=uuid.uuid4(),
            objective="存量团队目标",
            session_id=None,
        )
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        for role in ("arch", "code_style"):
            run = AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role=role,
                objective=f"{role} objective",
                output_redacted=f"{role} 结构化摘要",
            )
            db_session.add(run)
        await db_session.commit()
        trigger = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.mission_id == mission.id, AgentRun.role == "arch"
                    )
                )
            )
            .scalars()
            .first()
        )
        assert trigger is not None

        status = await converge_mission_for_completed_run(db_session, trigger.id, None)

        assert status == "done", "存量 mission 收敛语义零回归"
        await db_session.refresh(mission)
        assert mission.converged_at is not None
        assert captured == [], "无子会话零 WS 下发（收口 helper 空集 no-op）"


# ── 4. task-08（2026-08-26-team-subsession-recursion）：converge 收口遍历含孙层 ──


class TestConvergeClosesGrandchildren:
    async def test_converge_ends_grandchild_sessions(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """design §5.E：converge 成功后孙层分身同样 end_session（全树收口遍历，
        best-effort 语义不变）——孙会话 ended + lease completed + SESSION_END。"""
        captured = _recording_ws_hub(monkeypatch)
        _ws, root, mission, user_id, rt, anchor = await _seed_tree(db_session)
        w1, l1 = await _seed_worker(
            db_session,
            root,
            mission,
            owner_id=user_id,
            runtime=rt,
            worker_done_at=datetime.now(UTC),
        )
        # 孙分身：parent 挂一层分身 w1、tree_depth=2，自带 interactive lease +
        # 首 run（mission_id+role 双标记，completed）+ worker_done。
        now = datetime.now(UTC)
        g_lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=None,
            metadata_={"claim_token": "tok", "session_id": "pending"},
            created_at=now,
            updated_at=now,
        )
        db_session.add(g_lease)
        grandchild = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            provider="claude",
            status="active",
            parent_session_id=w1.id,
            tree_depth=2,
            worker_done_at=datetime.now(UTC),
            lease_id=g_lease.id,
            runtime_id=rt.id,
        )
        db_session.add(grandchild)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="impl",
                agent_session_id=grandchild.id,
                objective="孙分身任务",
            )
        )
        await db_session.commit()
        await db_session.refresh(grandchild)
        _patch_finalize(monkeypatch, merged_branches=["workers/aaa"])

        status = await converge_mission_for_completed_run(
            db_session, anchor.id, None, converge_explicit=True
        )

        assert status == "done"
        # 全树收口：一层分身 + 孙分身均 ended、lease completed
        await db_session.refresh(w1)
        assert w1.status == "ended"
        await db_session.refresh(grandchild)
        assert grandchild.status == "ended"
        await db_session.refresh(l1)
        assert l1.status == "completed"
        await db_session.refresh(g_lease)
        assert g_lease.status == "completed"
        ends = _session_ends(captured)
        assert {p["session_id"] for p in ends} == {str(w1.id), str(grandchild.id)}
        assert {p["lease_id"] for p in ends} == {str(l1.id), str(g_lease.id)}


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
