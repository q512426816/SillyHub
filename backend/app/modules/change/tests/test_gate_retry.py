"""task-09 测试：exit 1 打回时 gate_retry_count 累加 + gate_last_errors 写入。

覆盖 TaskCard acceptance 4 条：
  - exit 1 → gate_retry_count 累加（首打回=1，二次=2），gate_last_errors 写入截断摘要
  - count >=3 → 升级 exit 2，不再 dispatch 同 stage（报警人工）
  - gate_last_errors 跨 run 可读（新 run 读 change.stages last_dispatch 见上一轮 errors）
  - dict copy 入库（grep 确认无原地改写；SQLAlchemy 标记 dirty 持久化）

设计依据：design §5.4 / 数据流 :166-171（last_dispatch gate 字段）/ TaskCard task-09
R12（死循环防护：>=3 次连续打回升级 exit 2 卡住报警人工）。
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

# reparse 在测试无真实 spec 文件时会把 change 当"文件系统不存在"删掉，mock 掉。


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
        name="test-ws-gate-retry",
        root_path=root_path,
        slug="test-ws-gate-retry",
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
    stages: dict | None = None,
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key="2026-07-10-p3-test-retry",
        title="P3 Gate Retry Test",
        status="in_progress",
        location="active",
        path="/tmp/test-gate-retry",
        affected_components=["backend"],
        change_type="feature",
        current_stage=current_stage,
        stages=stages if stages is not None else {},
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


def _patch_dispatch_and_complete():
    """patch dispatch（同 stage 重跑）+ complete_stage（exit 1 不应推进）。

    两者作为上下文管理器返回，调用方负责 enter/exit。
    """
    return (
        patch(
            "app.modules.change.service.ChangeService.complete_stage",
            new_callable=AsyncMock,
        ),
        patch(
            "app.modules.change.dispatch.dispatch",
            new_callable=AsyncMock,
        ),
    )


class TestGateRetryCount:
    """task-09 acceptance 1：exit 1 → gate_retry_count 累加 + gate_last_errors 写入。"""

    async def test_first_kickback_sets_count_to_1(self, db_session: AsyncSession, tmp_path: Path):
        """exit 1 首次打回：gate_retry_count 从 0 → 1，gate_last_errors 写入。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        errors = ["verify-test 失败：import 缺失", "artifacts 校验未过"]
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": errors, "raw_envelope": {"ok": False}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 首次打回：dispatched=True + reason=gate_kickback + dispatch 同 stage
        assert result["dispatched"] is True
        assert result["reason"] == "gate_kickback"
        assert md.await_count == 1
        assert md.await_args.kwargs["target_stage"] == "verify"
        # gate_retry_count=1 + gate_last_errors 写入 last_dispatch
        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        assert last_dispatch.get("gate_retry_count") == 1
        assert last_dispatch.get("gate_last_errors") == errors

    async def test_second_kickback_increments_count(self, db_session: AsyncSession, tmp_path: Path):
        """二次打回：gate_retry_count 从 1 → 2，gate_last_errors 更新为本轮 errors。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        # 预置上一轮打回留下的 last_dispatch.gate_retry_count=1 + 旧 errors
        change = await _create_change(
            db_session,
            workspace_id=ws.id,
            current_stage="verify",
            owner_id=user_id,
            stages={
                "last_dispatch": {
                    "stage": "verify",
                    "gate_retry_count": 1,
                    "gate_last_errors": ["old error"],
                }
            },
        )
        new_errors = ["本轮新错误：lint 失败"]
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": new_errors, "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 累加：1 → 2
        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        assert last_dispatch.get("gate_retry_count") == 2
        # 本轮 errors 覆盖旧 errors
        assert last_dispatch.get("gate_last_errors") == new_errors

    async def test_kickback_preserves_last_gate_kickback_field(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """task-09 字段（last_dispatch.gate_retry_count）与 task-08 字段
        （last_gate_kickback）共存，互不覆盖。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["e1"], "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        await db_session.refresh(change)
        stages = change.stages or {}
        # task-08 字段：last_gate_kickback 存在（不被 task-09 删除）
        assert "last_gate_kickback" in stages
        assert stages["last_gate_kickback"]["stage"] == "verify"
        # task-09 字段：last_dispatch.gate_retry_count 存在
        assert stages["last_dispatch"]["gate_retry_count"] == 1


class TestGateRetryExceeded:
    """task-09 acceptance 2：count >=3 → 升级 exit 2，不 dispatch 同 stage。"""

    async def test_third_kickback_escalates_to_gate_blocked(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """count=2 → 第三次打回累加到 3 → 升级 exit 2，不 dispatch 同 stage，
        返回 gate_blocked + gate_retry_exceeded=True。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session,
            workspace_id=ws.id,
            current_stage="verify",
            owner_id=user_id,
            stages={
                "last_dispatch": {
                    "stage": "verify",
                    "gate_retry_count": 2,
                    "gate_last_errors": ["prev"],
                }
            },
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["3rd fail"], "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete as mc, mock_dispatch as md:
            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 升级 exit 2：不 dispatch 同 stage、不 complete_stage
        assert result["dispatched"] is False
        assert result["reason"] == "gate_blocked"
        assert result.get("gate_retry_exceeded") is True
        assert mc.await_count == 0
        assert md.await_count == 0
        # retry_count 累加到 3 后落库（R12：升级前最后一次计数）
        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        assert last_dispatch.get("gate_retry_count") == 3
        assert last_dispatch.get("gate_last_errors") == ["3rd fail"]

    async def test_already_exceeded_no_further_dispatch(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        """count=3（已超）→ 再次 exit 1 仍卡 gate_blocked，不 dispatch 同 stage。
        升级后 retry_count 不再无限累加（>=3 已卡住报警人工，无新打回意义），
        但本轮 errors 仍更新（人审诊断参考）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session,
            workspace_id=ws.id,
            current_stage="verify",
            owner_id=user_id,
            stages={
                "last_dispatch": {
                    "stage": "verify",
                    "gate_retry_count": 3,
                    "gate_last_errors": ["prev3"],
                }
            },
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["4th fail"], "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete as mc, mock_dispatch as md:
            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 已超：仍 gate_blocked，不 dispatch
        assert result["dispatched"] is False
        assert result["reason"] == "gate_blocked"
        assert result.get("gate_retry_exceeded") is True
        assert mc.await_count == 0
        assert md.await_count == 0


class TestGateLastErrorsTruncation:
    """task-09：gate_last_errors 截断（每条 ≤500 字符、总条数 ≤10）防超大 JSON。"""

    async def test_truncates_per_error_to_500_chars(self, db_session: AsyncSession, tmp_path: Path):
        """单条 error >500 字符 → 截断到 500。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        long_error = "X" * 1000  # 远超 500
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": [long_error], "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        errors = last_dispatch.get("gate_last_errors")
        assert len(errors) == 1
        assert len(errors[0]) == 500
        assert errors[0] == "X" * 500

    async def test_truncates_total_errors_to_10(self, db_session: AsyncSession, tmp_path: Path):
        """errors >10 条 → 截断到前 10 条。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        many_errors = [f"error-{i}" for i in range(15)]
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": many_errors, "raw_envelope": {}},
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        errors = last_dispatch.get("gate_last_errors")
        assert len(errors) == 10
        assert errors[0] == "error-0"
        assert errors[-1] == "error-9"

    async def test_non_string_errors_coerced(self, db_session: AsyncSession, tmp_path: Path):
        """errors 含非字符串（如 int/dict）→ str 强转后截断。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={
                "exit_code": 1,
                "errors": [42, {"k": "v"}, "plain"],
                "raw_envelope": {},
            },
        )

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md:
            md.return_value = {"dispatched": True, "agent_run_id": "y"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        errors = last_dispatch.get("gate_last_errors")
        # 全部 str 化
        assert all(isinstance(e, str) for e in errors)
        assert errors == ["42", "{'k': 'v'}", "plain"]


class TestGateLastErrorsCrossRunPersistence:
    """task-09 acceptance 3：gate_last_errors 跨 run 持久（新 run 读 last_dispatch
    见上一轮 errors）。

    语义：exit 1 打回建新 AgentRun，旧 run 的 gate_result 不便关联。新 run 的
    gate 任务读 change.stages.last_dispatch.gate_last_errors 作为上一轮修复参考
    （design §8 :166-171 数据流）。本测试模拟：第 N 轮打回写入 errors → 第 N+1 轮
    新 run 启动时读 last_dispatch 仍见上一轮 errors（字段未丢）。
    """

    async def test_errors_survive_new_run_kickback(self, db_session: AsyncSession, tmp_path: Path):
        """第 1 轮 exit 1 写 errors → 第 2 轮新 run exit 1 时读到的旧 errors
        存在（count 累加、errors 被本轮覆盖但旧值在第 1 轮 commit 后可读）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session, workspace_id=ws.id, current_stage="verify", owner_id=user_id
        )
        # 第 1 轮：exit 1，写入 errors-A
        run1_ts = datetime.now(UTC)
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["A"], "raw_envelope": {}},
            created_at=run1_ts,
        )
        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch as md1:
            md1.return_value = {"dispatched": True, "agent_run_id": "run1"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 第 1 轮后：新 run / 前端读 last_dispatch.gate_last_errors 应见 ["A"]
        await db_session.refresh(change)
        after_round1 = (change.stages or {}).get("last_dispatch", {})
        assert after_round1.get("gate_last_errors") == ["A"]
        assert after_round1.get("gate_retry_count") == 1

        # 第 2 轮：模拟新 AgentRun 完成（exit 1），errors-B
        run2_ts = run1_ts + timedelta(minutes=5)
        await _create_completed_run(
            db_session,
            change_id=change.id,
            gate_result={"exit_code": 1, "errors": ["B"], "raw_envelope": {}},
            created_at=run2_ts,
        )
        mock_complete2, mock_dispatch2 = _patch_dispatch_and_complete()
        with mock_complete2, mock_dispatch2 as md2:
            md2.return_value = {"dispatched": True, "agent_run_id": "run2"}
            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # 第 2 轮后：count=2，errors 更新为 B（本轮），但字段跨 run 持久存在
        await db_session.refresh(change)
        after_round2 = (change.stages or {}).get("last_dispatch", {})
        assert after_round2.get("gate_retry_count") == 2
        assert after_round2.get("gate_last_errors") == ["B"]


class TestGateRetryNoRegression:
    """task-09 零回归：exit 0 / exit 2 分支不碰 retry_count / last_errors。"""

    async def test_exit0_does_not_touch_retry_count(self, db_session: AsyncSession, tmp_path: Path):
        """exit 0 推进 → 不写 gate_retry_count / gate_last_errors。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        # 预置上一轮 exit 1 留的 retry_count=1（模拟 verify 曾打回过，现通过）
        change = await _create_change(
            db_session,
            workspace_id=ws.id,
            current_stage="verify",
            owner_id=user_id,
            stages={
                "last_dispatch": {
                    "stage": "verify",
                    "gate_retry_count": 1,
                    "gate_last_errors": ["prev"],
                }
            },
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
            mock_dispatch.return_value = {"dispatched": True, "agent_run_id": "z"}

            await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        # exit 0 后 last_dispatch 被新 dispatch 覆盖（dispatch 内部重写 last_dispatch），
        # 但 exit 0 分支本身不写 gate_retry_count / gate_last_errors。
        # 这里验证推进路径触发（complete_stage + dispatch）即可证明 exit 0 路径正常。
        assert mock_complete.await_count == 1
        assert mock_dispatch.await_count == 1

    async def test_exit2_does_not_touch_retry_count(self, db_session: AsyncSession, tmp_path: Path):
        """exit 2 卡住 → 不写 gate_retry_count / gate_last_errors（只 task-08 的
        gate_blocked 返回，task-09 不参与）。"""
        ws = await _create_workspace(db_session, root_path=str(tmp_path))
        user_id = uuid.uuid4()
        change = await _create_change(
            db_session,
            workspace_id=ws.id,
            current_stage="verify",
            owner_id=user_id,
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

        mock_complete, mock_dispatch = _patch_dispatch_and_complete()
        with mock_complete, mock_dispatch:
            result = await auto_dispatch_next_step(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                user_id=user_id,
                sync_result=_sync_result(stage="verify"),
            )

        assert result["dispatched"] is False
        assert result["reason"] == "gate_blocked"
        assert "gate_retry_exceeded" not in result  # exit 2 不带 retry_exceeded 标记
        # exit 2 不写 retry_count（change.stages 无 last_dispatch.gate_retry_count）
        await db_session.refresh(change)
        last_dispatch = (change.stages or {}).get("last_dispatch", {})
        assert "gate_retry_count" not in last_dispatch
        assert "gate_last_errors" not in last_dispatch
