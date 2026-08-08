"""砍 auto_dispatch 回归改写：gate retry 数据纪律（截断 / 上限 / merge 保留）。

背景（change-center-on-demand task-14 / FR-01 / R-05）：Wave 1（task-01~06）删掉
``auto_dispatch_next_step`` 后，「exit 1 自动打回重跑 + gate_retry_count 自动累加 +
count>=3 自动升级 exit 2」的连轴逻辑随之删除。新语义为形态A「按需触发」：

  - gate 后台任务只落 gate_result + gate_status（不自动重跑 / 不自动升级）。
  - gate_retry_count / gate_last_errors 仍落 ``change.stages.last_dispatch``（dispatch()
    经 ``_write_last_dispatch_payload`` merge：同 stage 保留、跨 stage 重置），作为
    advance_change_stage / 前端显式决策「同 stage 连续失败次数」的依据。
  - 截断纪律（``_truncate_gate_errors``：单条 ≤500 字符、总条数 ≤10、非 str 强转）与
    升级上限（``_GATE_RETRY_LIMIT = 3``）保留，供决策方读取。

本文件核验上述保留的数据纪律，不再断言任何自动打回 / 自动升级。核验纪律（CLAUDE.md
第 9 条）保留：截断 / merge / 上限断言不弱化，只把「自动连轴」断言改写为「数据落库 +
显式决策可读」。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.dispatch import (
    _GATE_ERROR_MAX_CHARS,
    _GATE_ERROR_MAX_COUNT,
    _GATE_RETRY_LIMIT,
    StageAgentConfig,
    _truncate_gate_errors,
    dispatch,
)
from app.modules.change.model import Change
from app.modules.workspace.model import Workspace


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


class TestGateRetryLimitConstant:
    """升级上限常量保留（design §10 R12 死循环防护阈值）。

    形态A：不再自动累加 / 自动升级，但「同 stage 连续失败达 3 次升级卡住报警人工」的
    阈值仍是 3，供 advance_change_stage / 前端显式决策读取 last_dispatch.gate_retry_count
    对照。常量值不可漂移（漂移会破坏决策方判断）。
    """

    def test_retry_limit_is_three(self) -> None:
        assert _GATE_RETRY_LIMIT == 3


class TestGateErrorsTruncation:
    """gate errors 截断纪律（``_truncate_gate_errors``）保留，防 change.stages JSON 超大。

    形态A：errors 仍要落 last_dispatch（供决策方读），截断规则不弱化。
    """

    def test_truncates_per_error_to_max_chars(self) -> None:
        """单条 error >500 字符 → 截断到 500。"""
        long_error = "X" * 1000
        result = _truncate_gate_errors([long_error])
        assert len(result) == 1
        assert len(result[0]) == _GATE_ERROR_MAX_CHARS
        assert result[0] == "X" * _GATE_ERROR_MAX_CHARS

    def test_truncates_total_errors_to_max_count(self) -> None:
        """errors >10 条 → 截断到前 10 条。"""
        many_errors = [f"error-{i}" for i in range(15)]
        result = _truncate_gate_errors(many_errors)
        assert len(result) == _GATE_ERROR_MAX_COUNT
        assert result[0] == "error-0"
        assert result[-1] == f"error-{_GATE_ERROR_MAX_COUNT - 1}"

    def test_non_string_errors_coerced(self) -> None:
        """errors 含非字符串（int / dict）→ str 强转。"""
        result = _truncate_gate_errors([42, {"k": "v"}, "plain"])
        assert all(isinstance(e, str) for e in result)
        assert result == ["42", "{'k': 'v'}", "plain"]

    def test_non_list_errors_degrades_to_empty(self) -> None:
        """errors 非 list（None / str / dict）→ 空列表兜底（不抛）。"""
        assert _truncate_gate_errors(None) == []
        assert _truncate_gate_errors("not-a-list") == []
        assert _truncate_gate_errors({"k": "v"}) == []

    def test_max_constants_unchanged(self) -> None:
        """截断阈值常量不漂移（500 字符 / 10 条）。"""
        assert _GATE_ERROR_MAX_CHARS == 500
        assert _GATE_ERROR_MAX_COUNT == 10


class TestDispatchPreservesGateRetryCount:
    """dispatch() merge last_dispatch 保留 gate_retry_count / gate_last_errors（同 stage）。

    第四批 code-quality 回归（保留）：dispatch() 用全新 dict 覆盖 last_dispatch 会丢弃
    gate_retry_count → 决策方读回 0 → R12 升级判断失效。dispatch() 经
    ``_write_last_dispatch_payload`` merge：同 stage 保留计数 / errors，跨 stage 重置。
    本组直接测 dispatch() 的 merge / 跨 stage 重置行为，不 mock dispatch 本身。
    """

    async def _dispatch_with_fake_run(
        self,
        db_session: AsyncSession,
        ws: Workspace,
        change: Change,
        *,
        target_stage: str,
        user_id: uuid.UUID,
    ) -> None:
        from types import SimpleNamespace

        fake_run = SimpleNamespace(id=uuid.uuid4())
        with (
            patch(
                "app.modules.change.dispatch.get_config_for_stage",
                return_value=StageAgentConfig(prompt_template="verify.md", read_only=True),
            ),
            patch(
                "app.modules.change.dispatch.has_active_run",
                new_callable=AsyncMock,
                return_value=False,
            ),
            patch(
                "app.modules.change.dispatch._cleanup_before_dispatch",
                new_callable=AsyncMock,
            ),
            patch(
                "app.modules.agent.service.AgentService.start_stage_dispatch",
                new_callable=AsyncMock,
                return_value=fake_run,
            ),
        ):
            await dispatch(
                session=db_session,
                workspace_id=ws.id,
                change_id=change.id,
                target_stage=target_stage,
                user_id=user_id,
            )

    async def test_preserves_count_same_stage(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """同 stage 重跑：gate_retry_count / gate_last_errors 经 dispatch() 保留。"""
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
                    "gate_last_errors": ["prev-fail"],
                }
            },
        )
        await self._dispatch_with_fake_run(
            db_session, ws, change, target_stage="verify", user_id=user_id
        )
        await db_session.refresh(change)
        last = (change.stages or {}).get("last_dispatch", {})
        assert last.get("gate_retry_count") == 2  # 修前被全新 dict 覆盖丢失
        assert last.get("gate_last_errors") == ["prev-fail"]
        assert last.get("stage") == "verify"
        assert "run_id" in last  # dispatch() merge 写入

    async def test_resets_count_on_stage_change(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """跨 stage 推进：gate_retry_count 重置（gate count 是「同 stage 连续失败」语义）。"""
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
                    "gate_last_errors": ["prev-fail"],
                }
            },
        )
        await self._dispatch_with_fake_run(
            db_session, ws, change, target_stage="archive", user_id=user_id
        )
        await db_session.refresh(change)
        last = (change.stages or {}).get("last_dispatch", {})
        assert "gate_retry_count" not in last  # 跨 stage 重置
        assert "gate_last_errors" not in last
        assert last.get("stage") == "archive"

    async def test_retry_count_survives_for_caller_decision(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """同 stage 连续重跑后 retry_count 可读（advance 决策「是否达上限」的依据）。

        预置 count=2（= _GATE_RETRY_LIMIT - 1），同 stage 再 dispatch 一次后 count 仍 2
        保留可读——决策方据此判断「再打回一次即达 3 上限」。形态A：dispatch() 不自动累加
        （累加交决策方），但已落库的 count 必须保真不被 merge 丢弃。
        """
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
                    "gate_retry_count": _GATE_RETRY_LIMIT - 1,
                    "gate_last_errors": ["prev"],
                }
            },
        )
        await self._dispatch_with_fake_run(
            db_session, ws, change, target_stage="verify", user_id=user_id
        )
        await db_session.refresh(change)
        last = (change.stages or {}).get("last_dispatch", {})
        # count 保真可读，决策方据此对照 _GATE_RETRY_LIMIT 判断升级。
        assert last.get("gate_retry_count") == _GATE_RETRY_LIMIT - 1
