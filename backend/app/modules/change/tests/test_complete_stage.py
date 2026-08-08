"""Tests for complete_stage + _resolve_stage_completion after W2 remap.

After task-01 removed HumanGate and task-04 remapped, _resolve_stage_completion
returns a 2-tuple (new_stage, dispatch_target). propose/quick/blocked/draft are
no longer part of the mainline mapping.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.service import ChangeService


class TestResolveStageCompletion:
    """_resolve_stage_completion returns (new_stage, dispatch_target) 2-tuple."""

    @pytest.mark.parametrize(
        "stage, result, expected_stage, expected_dispatch",
        [
            # brainstorm mainline: clear → dispatch plan
            ("brainstorm", "clear", "plan", "plan"),
            ("brainstorm", None, "plan", "plan"),
            # brainstorm ambiguous → stay (no dispatch)
            ("brainstorm", "ambiguous", "brainstorm", None),
            # plan → dispatch execute
            ("plan", None, "execute", "execute"),
            # execute → dispatch verify
            ("execute", None, "verify", "verify"),
            # verify passed → dispatch archive
            ("verify", "passed", "archive", "archive"),
            # verify not passed → stay verify (no dispatch, await human)
            ("verify", None, "verify", None),
            ("verify", "failed", "verify", None),
            # archive → terminal archived (no dispatch)
            ("archive", None, "archived", None),
        ],
    )
    def test_mapping(self, stage, result, expected_stage, expected_dispatch):
        new_stage, dispatch_target = ChangeService._resolve_stage_completion(stage, result)
        assert new_stage == expected_stage
        assert dispatch_target == expected_dispatch

    def test_unknown_stage_no_change(self):
        # Unknown stage returns identity (no change)
        new_stage, dispatch_target = ChangeService._resolve_stage_completion("unknown", None)
        assert new_stage == "unknown"
        assert dispatch_target is None

    def test_scan_stays(self):
        # scan is auxiliary — completion stays scan
        new_stage, _dispatch_target = ChangeService._resolve_stage_completion("scan", None)
        assert new_stage == "scan"


# ── complete_stage 持久化契约（2026-08-08 task-16，team 推进桥）─────────────
# team mission 收敛后 ``RunSyncService._advance_team_stage`` 的唯一桥就是
# ``ChangeService.complete_stage``（task-03 契约）。本类锁它的 DB 持久化行为：
# 推进 current_stage + 返回 dispatch_target 供「显式 advance」使用，**不**自己
# dispatch 下一 stage（AD-01：complete_stage 只更新 DB，形态A 砍自动连轴）。


async def _seed_change(
    session: AsyncSession,
    *,
    current_stage: str,
    stages: dict | None = None,
):
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="ws-complete-stage",
        slug=f"ws-cs-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/ws-cs",
        status="active",
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"cs-{uuid.uuid4().hex[:6]}",
        title="complete stage test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/cs",
        current_stage=current_stage,
        stages=stages if stages is not None else {"team_mode": True},
    )
    session.add_all([ws, change])
    await session.commit()
    await session.refresh(change)
    return ws, change


class TestCompleteStagePersistence:
    """complete_stage 推进 current_stage + 返回 dispatch_target（不自动 dispatch）。"""

    async def test_execute_advances_to_verify_returns_dispatch_target(
        self, db_session: AsyncSession
    ) -> None:
        """execute 完成 → current_stage=verify，dispatch_target=verify（待显式 advance）。"""
        ws, change = await _seed_change(db_session, current_stage="execute")
        svc = ChangeService(db_session)

        result = await svc.complete_stage(
            workspace_id=ws.id, change_id=change.id, stage="execute", result=None
        )

        assert result.change.current_stage == "verify"
        # dispatch_target 告知「下一待显式触发的 stage」，complete_stage 自身不 dispatch。
        assert result.dispatch_target == "verify"
        await db_session.refresh(change)
        assert change.current_stage == "verify"
        # 未归档：status 保持 in-progress（非 archived）。
        assert change.status == "in-progress"

    async def test_verify_passed_advances_to_archive(self, db_session: AsyncSession) -> None:
        """verify + passed → current_stage=archive，dispatch_target=archive。"""
        ws, change = await _seed_change(db_session, current_stage="verify")
        svc = ChangeService(db_session)

        result = await svc.complete_stage(
            workspace_id=ws.id, change_id=change.id, stage="verify", result="passed"
        )

        assert result.change.current_stage == "archive"
        assert result.dispatch_target == "archive"
        await db_session.refresh(change)
        assert change.current_stage == "archive"

    async def test_verify_not_passed_stays_verify_no_dispatch(
        self, db_session: AsyncSession
    ) -> None:
        """verify 未 passed → 停 verify，dispatch_target=None（待人工/advance 决策）。"""
        ws, change = await _seed_change(db_session, current_stage="verify")
        svc = ChangeService(db_session)

        result = await svc.complete_stage(
            workspace_id=ws.id, change_id=change.id, stage="verify", result=None
        )

        assert result.change.current_stage == "verify"
        assert result.dispatch_target is None
        await db_session.refresh(change)
        assert change.current_stage == "verify"

    async def test_archive_projects_archived_status(self, db_session: AsyncSession) -> None:
        """archive 完成 → current_stage=archived，投影 status=archived/location=archive。"""
        ws, change = await _seed_change(db_session, current_stage="archive")
        svc = ChangeService(db_session)

        result = await svc.complete_stage(
            workspace_id=ws.id, change_id=change.id, stage="archive", result=None
        )

        assert result.change.current_stage == "archived"
        assert result.dispatch_target is None
        await db_session.refresh(change)
        assert change.current_stage == "archived"
        assert change.status == "archived"
        assert change.location == "archive"
        assert change.archived_at is not None

    async def test_complete_stage_does_not_auto_dispatch(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AD-01/形态A：complete_stage 只更新 DB，绝不触发 dispatch（无自动连轴）。

        锁死「team 收敛桥不自动建下一 stage mission」的下层保证——桥内调
        complete_stage 推进 current_stage 后，下一 stage 交 advance_change_stage。
        """
        ws, change = await _seed_change(db_session, current_stage="execute")

        dispatched = []

        async def _boom(*args, **kwargs):  # pragma: no cover - 不应被调
            dispatched.append((args, kwargs))
            raise AssertionError("complete_stage must not dispatch")

        # dispatch 模块层与 service 内 lazy import 两路都堵死。
        monkeypatch.setattr("app.modules.change.dispatch.dispatch", _boom, raising=False)
        monkeypatch.setattr(
            "app.modules.change.dispatch._dispatch_execute_team", _boom, raising=False
        )

        svc = ChangeService(db_session)
        result = await svc.complete_stage(
            workspace_id=ws.id, change_id=change.id, stage="execute", result=None
        )

        assert result.change.current_stage == "verify"
        assert dispatched == []
