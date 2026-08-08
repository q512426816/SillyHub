"""砍 auto_dispatch 回归改写：gate 决策数据源 + 停待触发 + 显式 advance 推进。

背景（change-center-on-demand task-14 / FR-01 / R-05）：Wave 1（task-01~06）删掉
``auto_dispatch_next_step``（dispatch.py:240）后，gate 三态决策不再「自动连轴推进」。
新语义为形态A「按需触发」：

  - gate 后台任务（run_sync/_run_gate_decision_task）只把 ``gate_result`` +
    ``gate_status='decided'`` 落库 + 发 SSE，**不改 current_stage、不 dispatch 下一 stage**。
  - gate 三态决策数据源是 ``_read_latest_gate_result``（取本 change 最近一条 completed
    run 的 gate_result），交 ``advance_change_stage`` / ``transition_with_dispatch`` /
    ``complete_stage`` 显式读取并决策。
  - stage 完成停在「待触发」态，current_stage 不变；只有显式 advance（complete_stage）
    才推进。

本文件核验「按需触发」语义，不再断言任何自动推进。核验纪律（CLAUDE.md 第 9 条）保留：
断言从「自动连轴推进」改写为「停待触发 + 显式 advance 才推进」，不是删断言。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import _read_latest_gate_result, _record_gate_kickback
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace


async def _create_workspace(session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-ws-gate",
        root_path=root_path,
        slug="test-ws-gate",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    current_stage: str = "verify",
    owner_id: uuid.UUID | None = None,
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="2026-07-10-p3-test-gate",
        title="P3 Gate Test",
        status="in_progress",
        location="active",
        path="/tmp/test-gate",
        affected_components=["backend"],
        change_type="feature",
        current_stage=current_stage,
        stages={},
        owner_id=owner_id,
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _create_completed_run(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    gate_result: dict | None,
    gate_status: str = "decided",
    created_at: datetime | None = None,
) -> AgentRun:
    """创建一条 completed 的 AgentRun，带指定 gate_result。"""
    ts = created_at or datetime.now(UTC)
    run = AgentRun(
        id=uuid.uuid4(),
        change_id=change_id,
        agent_type="claude_code",
        status="completed",
        gate_status=gate_status,
        gate_result=gate_result,
    )
    session.add(run)
    await session.commit()
    # 强制 created_at（模型 server_default now()，commit 后手动覆盖回写）
    run.created_at = ts
    run.finished_at = ts
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


class TestReadLatestGateResult:
    """gate 三态决策数据源：``_read_latest_gate_result`` 取最近 completed run 的 gate_result。

    形态A：gate 结果落库后由 advance_change_stage / transition_with_dispatch 显式读取，
    本函数是「按需触发」读取入口。数据源行为保留（exit 0/1/2 三态原样读出），只是不再
    接自动推进。
    """

    async def test_returns_latest_gate_result_exit0(self, db_session: AsyncSession, tmp_path: Path):
        """exit 0 gate_result 可读出（推进决策的依据）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        run = await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 0, "errors": [], "raw_envelope": {"ok": True}},
        )

        gate_result, run_id = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is not None
        assert gate_result["exit_code"] == 0
        assert run_id == run.id

    async def test_returns_latest_gate_result_exit1_with_errors(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 1 gate_result 含 errors（打回决策的依据），原样读出。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        errors = ["verify-test 失败：import 缺失", "artifacts 校验未过"]
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": errors, "raw_envelope": {"ok": False}},
        )

        gate_result, _ = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is not None
        assert gate_result["exit_code"] == 1
        assert gate_result["errors"] == errors

    async def test_returns_latest_gate_result_exit2(self, db_session: AsyncSession, tmp_path: Path):
        """exit 2 gate_result（卡住报警决策的依据），原样读出。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={
                "exit_code": 2,
                "errors": ["gate 执行异常: daemon 离线"],
                "raw_envelope": {},
            },
        )

        gate_result, _ = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is not None
        assert gate_result["exit_code"] == 2

    async def test_no_completed_run_returns_none(self, db_session: AsyncSession, tmp_path: Path):
        """无 completed run → (None, None)（gate 未跑，advance 读不到结果交显式决策）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")

        gate_result, run_id = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is None
        assert run_id is None

    async def test_picks_most_recent_completed_run(self, db_session: AsyncSession, tmp_path: Path):
        """取本 change 最近一条 completed run（按 created_at 降序）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        # 旧 run exit 1，新 run exit 0 —— 应取新的 exit 0
        old_ts = datetime.now(UTC) - timedelta(minutes=10)
        new_ts = datetime.now(UTC)
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["old"], "raw_envelope": {}},
            created_at=old_ts,
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 0, "errors": [], "raw_envelope": {"ok": True}},
            created_at=new_ts,
        )

        gate_result, _ = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is not None
        assert gate_result["exit_code"] == 0

    async def test_running_run_not_read(self, db_session: AsyncSession, tmp_path: Path):
        """running（非 completed）run 不被读为 gate 决策源（gate 未完成）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        running = AgentRun(
            id=uuid.uuid4(),
            change_id=change.id,
            agent_type="claude_code",
            status="running",
            gate_status="running",
            gate_result=None,
        )
        db_session.add(running)
        await db_session.commit()

        gate_result, run_id = await _read_latest_gate_result(db_session, change.id)

        assert gate_result is None
        assert run_id is None


class TestGateCompletionDoesNotAutoAdvance:
    """形态A 核心：gate 完成 / 落库后 stage 停在「待触发」态，不自动推进。

    砍 auto_dispatch 后，gate_result 落库只改 AgentRun 行，不动 Change.current_stage。
    推进必须显式调 complete_stage（advance_change_stage 桥）。
    """

    async def test_gate_result_storage_leaves_current_stage_unchanged(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 0 gate_result 落库后 change.current_stage 不变（停待触发，不自动推进）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 0, "errors": [], "raw_envelope": {"ok": True}},
        )

        await db_session.refresh(change)
        # gate 完成只落 gate_result，current_stage 仍是 verify（待触发，未自动推进到 archive）。
        assert change.current_stage == "verify"

    async def test_explicit_complete_stage_advances(self, db_session: AsyncSession, tmp_path: Path):
        """显式 complete_stage（advance_change_stage 桥）才推进 current_stage。

        读 gate_result exit 0 → 显式 complete_stage(result="passed") → verify 推进到 archive。
        """
        from app.modules.change.service import ChangeService

        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 0, "errors": [], "raw_envelope": {"ok": True}},
        )

        # 决策方读 gate_result（exit 0 → passed），显式 advance。
        gate_result, _ = await _read_latest_gate_result(db_session, change.id)
        assert gate_result is not None
        assert gate_result["exit_code"] == 0
        svc = ChangeService(db_session)
        result = await svc.complete_stage(
            workspace_id=ws.id,
            change_id=change.id,
            stage="verify",
            result="passed",
            summary=None,
        )

        # 显式 advance 后才推进到 archive。
        assert result.change.current_stage == "archive"

    async def test_complete_stage_without_pass_stays(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 非 0（不传 passed）→ complete_stage 不推进（停 verify，交显式决策）。"""
        from app.modules.change.service import ChangeService

        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        change = await _create_change(db_session, workspace_id=ws.id, current_stage="verify")
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["fail"], "raw_envelope": {}},
        )

        # 决策方读 gate_result exit 1 → 不推进（result=None）。
        gate_result, _ = await _read_latest_gate_result(db_session, change.id)
        assert gate_result is not None
        assert gate_result["exit_code"] == 1
        svc = ChangeService(db_session)
        result = await svc.complete_stage(
            workspace_id=ws.id,
            change_id=change.id,
            stage="verify",
            result=None,  # exit 1 → 不视为 passed，不推进
            summary=None,
        )

        # verify + 非 passed → 停 verify（_resolve_stage_completion(verify, None)）。
        assert result.change.current_stage == "verify"


class TestRecordGateKickback:
    """exit 1 打回点落库（``_record_gate_kickback``）：只记录，不自动 dispatch 重跑。

    形态A：打回点保留（供 retry_count / 审计），但「dispatch 同 stage 重跑」改由
    advance_change_stage 显式触发，不再自动连轴。
    """

    async def test_records_kickback_point(self, db_session: AsyncSession, tmp_path: Path):
        """_record_gate_kickback 把打回点落 change.stages.last_gate_kickback。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        errors = ["verify-test 失败：import 缺失", "artifacts 校验未过"]
        run = await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": errors, "raw_envelope": {"ok": False}},
        )

        await _record_gate_kickback(
            db_session,
            change,
            stage="verify",
            gate_result={"exit_code": 1, "errors": errors, "raw_envelope": {"ok": False}},
            gate_run_id=run.id,
            user_id=user_id,
        )

        await db_session.refresh(change)
        stages = change.stages or {}
        kickback = stages.get("last_gate_kickback")
        assert kickback is not None, "exit 1 必须留打回点（审计 / retry_count 依据）"
        assert kickback["stage"] == "verify"
        assert kickback["errors"] == errors
        assert kickback["gate_run_id"] == str(run.id)

    async def test_kickback_does_not_change_current_stage(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """打回点落库不改 current_stage（不自动推进 / 不自动重跑，停待触发）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        run = await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["fail"], "raw_envelope": {}},
        )

        await _record_gate_kickback(
            db_session,
            change,
            stage="verify",
            gate_result=run.gate_result,
            gate_run_id=run.id,
            user_id=user_id,
        )

        await db_session.refresh(change)
        # 打回只留打回点，current_stage 不变（重跑交 advance_change_stage 显式触发）。
        assert change.current_stage == "verify"
