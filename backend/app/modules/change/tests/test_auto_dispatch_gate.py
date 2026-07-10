"""task-08 测试：auto_dispatch_next_step 的 gate 三态决策。

覆盖 design §5.4 五条 acceptance：
  - exit 0 → complete_stage + dispatch 下一 stage（推进不变）
  - exit 1 → 不 complete_stage，dispatch 同 stage + feedback=errors，留打回点
  - exit 2 → 不推进不 dispatch，fail-loud 报警（reason=gate_blocked）
  - verify stage gate_result None → 阻断（不读 verify-result.md）
  - 非 verify stage + gate_result None → fallback 声明态推进（零回归）
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.change.dispatch import (
    StageSyncResult,
    auto_dispatch_next_step,
)
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace

# reparse 会按文件系统重新解析 change（测试无真实文件 → deleted=1 删掉 change）。
# gate 决策测试聚焦 dispatch.py 逻辑，reparse 是 ChangeService 的副作用，mock 掉。


@pytest.fixture(autouse=True)
def _mock_reparse():
    """auto-dispatch stage_completed 分支会调 ChangeService.reparse，测试无真实
    spec 文件，reparse 会把测试 change 当成"文件系统不存在"删掉。mock 掉避免副作用。"""
    with patch(
        "app.modules.change.service.ChangeService.reparse",
        new_callable=AsyncMock,
        return_value=None,
    ):
        yield


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


def _sync_result(*, stage: str = "verify", stage_completed: bool = True) -> StageSyncResult:
    return StageSyncResult(
        synced=True,
        change_id=uuid.UUID(int=0),
        run_id=uuid.uuid4(),
        current_stage=stage,
        stage_completed=stage_completed,
        has_pending_step=False,
    )


class TestAutoDispatchGateDecision:
    """task-08：auto_dispatch_next_step stage_completed 分支的三态决策。"""

    async def test_exit0_advance_completes_and_dispatches_next(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 0 → complete_stage + dispatch 下一 stage（推进不变）。"""
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

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            from app.modules.change.service import CompleteStageResult

            mock_complete.return_value = CompleteStageResult(
                change=change, dispatch_target="archive", gate="none"
            )
            mock_dispatch.return_value = {"dispatched": True, "agent_run_id": "x"}

            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # complete_stage 被调用（推进）
        assert mock_complete.await_count == 1
        assert mock_complete.await_args.kwargs["stage"] == "verify"
        # verify stage 强制 gate：result 参数应是 "passed"（exit 0 → passed）
        assert mock_complete.await_args.kwargs["result"] == "passed"
        # dispatch 下一 stage
        assert mock_dispatch.await_count == 1
        assert result["dispatched"] is True

    async def test_exit1_kickback_dispatches_same_stage_with_feedback(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 1 → 不 complete_stage，dispatch 同 stage + feedback=errors，留打回点。"""
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

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            mock_dispatch.return_value = {"dispatched": True, "agent_run_id": "y"}

            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 不 complete_stage（打回，不推进）
        assert mock_complete.await_count == 0
        # dispatch 同 stage（verify 重跑）
        assert mock_dispatch.await_count == 1
        assert mock_dispatch.await_args.kwargs["target_stage"] == "verify"
        # feedback=errors 注入（经 prompt context 或 kwargs 传递）
        assert result["dispatched"] is True
        assert result["reason"] == "gate_kickback"
        # 留打回点：change.stages.last_dispatch 或专门字段记录 errors + gate_run_id
        await db_session.refresh(change)
        stages = change.stages or {}
        kickback = stages.get("last_gate_kickback")
        assert kickback is not None, "exit 1 必须留打回点供 task-09 接 retry_count"
        assert kickback["stage"] == "verify"
        assert kickback["errors"] == errors
        assert kickback["gate_run_id"] == str(run.id)

    async def test_exit2_block_no_dispatch_no_complete(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """exit 2 → 不推进不 dispatch，fail-loud 报警（reason=gate_blocked）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={
                "exit_code": 2,
                "errors": ["gate 执行异常: daemon 离线"],
                "raw_envelope": {},
            },
        )

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        assert result["dispatched"] is False
        assert result["reason"] == "gate_blocked"
        assert mock_complete.await_count == 0
        assert mock_dispatch.await_count == 0

    async def test_verify_gate_result_none_blocks_no_fallback(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """verify stage gate_result None → 阻断（不读 verify-result.md）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        # gate_result=None（未跑 / 异常 / sillyspec 未发版）
        await _create_completed_run(
            db_session, change_id=change.id, gate_result=None, gate_status=None
        )

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.read_verify_result",
                new_callable=AsyncMock,
            ) as mock_read_vr,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            mock_read_vr.return_value = "passed"  # 若 fallback 调用应被抓到

            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        assert result["dispatched"] is False
        assert result["reason"] == "gate_blocked"
        # 强制 gate：绝不 fallback 到 read_verify_result
        assert mock_read_vr.await_count == 0
        assert mock_complete.await_count == 0
        assert mock_dispatch.await_count == 0

    async def test_non_verify_gate_none_falls_back_to_declarative(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """非 verify stage + gate_result None → fallback 声明态推进（零回归）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="plan", owner_id=user_id
        )
        # plan stage + gate_result=None（brownfield：gate 只在 verify 跑）
        await _create_completed_run(
            db_session, change_id=change.id, gate_result=None, gate_status=None
        )

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            from app.modules.change.service import CompleteStageResult

            mock_complete.return_value = CompleteStageResult(
                change=change, dispatch_target="execute", gate="none"
            )
            mock_dispatch.return_value = {"dispatched": True, "agent_run_id": "z"}

            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="plan"),
            )

        # fallback：照常 complete_stage + dispatch 下一 stage（零回归）
        assert mock_complete.await_count == 1
        assert mock_complete.await_args.kwargs["stage"] == "plan"
        # 非 verify stage：result=None（不调 read_verify_result）
        assert mock_complete.await_args.kwargs["result"] is None
        assert mock_dispatch.await_count == 1
        assert result["dispatched"] is True

    async def test_picks_most_recent_completed_run(self, db_session: AsyncSession, tmp_path: Path):
        """取本 change 最近一条 completed 的 agent_run（按 created_at 降序）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        # 旧 run exit 1，新 run exit 0 —— 应取新的 exit 0 推进
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

        with (
            patch(
                "app.modules.change.service.ChangeService.complete_stage",
                new_callable=AsyncMock,
            ) as mock_complete,
            patch(
                "app.modules.change.dispatch.dispatch",
                new_callable=AsyncMock,
            ) as mock_dispatch,
        ):
            from app.modules.change.service import CompleteStageResult

            mock_complete.return_value = CompleteStageResult(
                change=change, dispatch_target="archive", gate="none"
            )
            mock_dispatch.return_value = {"dispatched": True, "agent_run_id": "w"}

            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 取新 run exit 0 → complete_stage 被调用（推进）
        assert mock_complete.await_count == 1
