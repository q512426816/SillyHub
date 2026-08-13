"""stages JSON 列持久化回归（2026-08-09 sweep, ql-20260809-002-4219）。

背景：``change.stages`` 是普通 ``Column(JSON)`` 非 ``MutableDict.as_mutable``
（``model.py``）。所有改 stages 的方法必须 ``dict(change.stages or {})`` 浅拷贝后再改 +
回赋，否则 SQLAlchemy 的 set 事件见 ``new is old``（同对象）不标记 dirty，flush 的 UPDATE
不带 stages 列 → 该方法写入的 stages 键丢失（current_stage 走独立列，正常）。

complete_stage 的持久化契约见 ``test_complete_stage.py``。本文件锁其余 7 个 stages-mutating
方法：transition / submit_feedback / proposal_review / plan_review / human_test /
rerun_stage / archive_confirm。每个用例 ``refresh`` 真读 DB（expire_on_commit 后强制重载）
抓「未落库」回归——断言被改方法写入的 stages 键在 refresh 后仍可见。
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.schema import PendingReview
from app.modules.change.service import ChangeService
from app.modules.change.tests.test_dispatch import (
    _completed_stages,
    _create_test_change,
    _create_test_workspace,
)


def _patch_projection(pending: PendingReview | None):
    """Patch 投影返回指定 pending（绕过 sillyspec.db 依赖，复用 test_review_apis 范式）。"""
    return patch(
        "app.modules.change.service.StageProjectionService.compute_pending_review",
        new=AsyncMock(return_value=pending),
    )


async def _seed(session: AsyncSession, tmp_path: Path, *, stage: str):
    ws = await _create_test_workspace(session, root_path=str(tmp_path))
    change = await _create_test_change(
        session,
        workspace_id=ws.id,
        current_stage=stage,
        path=str(tmp_path / ".sillyspec" / "changes" / "c" / "t"),
    )
    # 关键：seed 非空 stages。``stages={}`` 时 ``change.stages or {}`` 取新对象（falsy），
    # 回赋被 SQLAlchemy 检测 → bug 不触发；必须非空 dict 才能让 ``or {}`` 返回同引用、
    # 原地改 + 回赋同对象不被检测（这正是生产路径：change 持续累积 stages 键，必非空）。
    # 同时给当前 stage 补完成块，过 transition 前置完成度校验（_check_source_stage_completion）。
    change.stages = {"team_mode": True, **_completed_stages(stage)}
    await session.commit()
    await session.refresh(change)
    return ws, change


def _wire_factory(factory_mock, db_session: AsyncSession) -> None:
    """把 dispatch 用的 independent session factory 指回测试 db_session（复用 test_review_apis 范式）。"""
    factory_mock.return_value.return_value.__aenter__ = AsyncMock(return_value=db_session)
    factory_mock.return_value.return_value.__aexit__ = AsyncMock(return_value=None)


@pytest.mark.asyncio
class TestStagesPersistenceSweep:
    """7 个 stages-mutating 方法的 stages 键必须落库（深拷贝回归）。

    每个用例经 ``refresh`` 真读 DB：若方法未 ``dict()`` 拷贝 stages，原地改 + 回赋同对象
    不被标记 dirty，flush 不带 stages 列，refresh 后该键消失 → 断言失败。
    """

    async def test_transition_persists_transitions_log(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)

        await svc.transition(ws.id, change.id, "plan", "admin", reason="go plan")

        await db_session.refresh(change)
        transitions = (change.stages or {}).get("transitions", [])
        assert any(t.get("from") == "brainstorm" and t.get("to") == "plan" for t in transitions), (
            "transition 的 transitions log 未落库：stages 须 dict() 拷贝后再回赋"
        )

    async def test_submit_feedback_persists_last_feedback(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)

        await svc.submit_feedback(ws.id, change.id, "A", "需要重做 execute", uuid.uuid4())

        await db_session.refresh(change)
        stages = change.stages or {}
        assert "last_feedback" in stages, "submit_feedback 的 last_feedback 未落库"
        assert stages["last_feedback"]["category"] == "A"
        assert stages["last_feedback"]["text"] == "需要重做 execute"
        # rework_target = target_stage or FEEDBACK_TARGETS["A"] = "execute"
        assert stages["last_feedback"]["rework_target"] == "execute"

    async def test_rerun_stage_persists_review_history(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)

        # user_id=None → 跳过 dispatch，聚焦 stages 持久化。
        await svc.rerun_stage(ws.id, change.id, "verify", comment="重跑", user_id=None)

        await db_session.refresh(change)
        history = (change.stages or {}).get("review_history", [])
        assert any(r.get("action") == "rerun" for r in history), (
            "rerun_stage 的 review_history 未落库：stages 须 dict() 拷贝后再回赋"
        )

    async def test_proposal_review_persists_review_history(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="brainstorm")
        svc = ChangeService(db_session)

        with (
            _patch_projection(PendingReview.PROPOSAL_REVIEW),
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "plan"}),
            ),
        ):
            _wire_factory(factory_mock, db_session)
            await svc.proposal_review(ws.id, change.id, "approve", "ok", uuid.uuid4())

        await db_session.refresh(change)
        history = (change.stages or {}).get("review_history", [])
        assert any(r.get("decision") == "approve" for r in history), (
            "proposal_review 的 review_history 未落库：stages 须 dict() 拷贝后再回赋"
        )

    async def test_plan_review_persists_review_history(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="plan")
        svc = ChangeService(db_session)

        with (
            _patch_projection(PendingReview.PLAN_REVIEW),
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "execute"}),
            ),
        ):
            _wire_factory(factory_mock, db_session)
            await svc.plan_review(ws.id, change.id, "approve", None, uuid.uuid4())

        await db_session.refresh(change)
        history = (change.stages or {}).get("review_history", [])
        assert any(r.get("decision") == "approve" for r in history), (
            "plan_review 的 review_history 未落库：stages 须 dict() 拷贝后再回赋"
        )

    async def test_human_test_persists_review_history(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="verify")
        svc = ChangeService(db_session)

        with (
            _patch_projection(PendingReview.HUMAN_TEST),
            patch("app.core.db.get_session_factory") as factory_mock,
            patch(
                "app.modules.change.dispatch.dispatch",
                new=AsyncMock(return_value={"dispatched": True, "stage": "archive"}),
            ),
        ):
            _wire_factory(factory_mock, db_session)
            await svc.human_test(ws.id, change.id, "pass", None, uuid.uuid4())

        await db_session.refresh(change)
        history = (change.stages or {}).get("review_history", [])
        assert any(r.get("decision") == "pass" for r in history), (
            "human_test 的 review_history 未落库：stages 须 dict() 拷贝后再回赋"
        )

    async def test_archive_confirm_persists_review_history(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        ws, change = await _seed(db_session, tmp_path, stage="archive")
        svc = ChangeService(db_session)

        with _patch_projection(PendingReview.ARCHIVE_CONFIRM):
            await svc.archive_confirm(ws.id, change.id, "confirmed", uuid.uuid4())

        await db_session.refresh(change)
        stages = change.stages or {}
        history = stages.get("review_history", [])
        assert any(r.get("decision") == "archive_confirm" for r in history), (
            "archive_confirm 的 review_history 未落库：stages 须 dict() 拷贝后再回赋"
        )
        assert stages.get("archive_confirmed", {}).get("confirmed") is True
