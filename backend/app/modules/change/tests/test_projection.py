"""StageProjectionService 单测（task-07，D-004@v2）。

验证基于 sillyspec.db ``stages`` 表完成事件的 pending_review 投影。
通过构造临时 sillyspec.db（与 daemon 落库同款 schema）mock 路径解析，
覆盖 4 种映射 + 无审核场景。不依赖真实 daemon db。
"""

from __future__ import annotations

import sqlite3
import uuid
from pathlib import Path
from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.dispatch import SillySpecStageDispatchService
from app.modules.change.projection import StageProjectionService
from app.modules.change.schema import PendingReview
from app.modules.change.tests.test_dispatch import (
    _create_test_change,
    _create_test_workspace,
)


def _write_sillyspec_db(
    db_path: Path,
    *,
    change_key: str,
    current_stage: str,
    completed_stages: list[str],
) -> None:
    """构造与 daemon 落库同款 schema 的临时 sillyspec.db。

    只填 projection 读取所需的列（changes.name/current_stage +
    stages.change_id/stage/status）。
    """
    conn = sqlite3.connect(str(db_path))
    try:
        conn.executescript(
            """
            CREATE TABLE changes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                current_stage TEXT DEFAULT 'scan',
                status TEXT DEFAULT 'active'
            );
            CREATE TABLE stages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                change_id INTEGER NOT NULL REFERENCES changes(id),
                stage TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                UNIQUE(change_id, stage)
            );
            """
        )
        conn.execute(
            "INSERT INTO changes (name, current_stage) VALUES (?, ?)",
            (change_key, current_stage),
        )
        change_id = conn.execute("SELECT id FROM changes WHERE name = ?", (change_key,)).fetchone()[
            0
        ]
        for stage in completed_stages:
            conn.execute(
                "INSERT INTO stages (change_id, stage, status) VALUES (?, ?, 'completed')",
                (change_id, stage),
            )
        conn.commit()
    finally:
        conn.close()


@pytest.mark.asyncio
class TestStageProjection:
    """D-004@v2 映射的 5 种场景。"""

    async def _setup(
        self,
        session: AsyncSession,
        tmp_path: Path,
        *,
        current_stage: str,
        completed_stages: list[str],
    ) -> tuple[uuid.UUID, Path]:
        ws = await _create_test_workspace(session, root_path=str(tmp_path))
        change = await _create_test_change(
            session,
            workspace_id=ws.id,
            path=str(tmp_path / ".sillyspec" / "changes" / "change" / "t"),
        )
        db_path = tmp_path / "sillyspec.db"
        _write_sillyspec_db(
            db_path,
            change_key=change.change_key,
            current_stage=current_stage,
            completed_stages=completed_stages,
        )
        return change.id, db_path

    async def test_brainstorm_completed_returns_proposal_review(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        change_id, db_path = await self._setup(
            db_session,
            tmp_path,
            current_stage="brainstorm",
            completed_stages=["brainstorm"],
        )
        with (
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path",
                new=_make_resolver(db_path),
            ),
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path_fallback",
                new=_make_resolver(None),
            ),
        ):
            svc = StageProjectionService(db_session)
            result = await svc.compute_pending_review(db_session, change_id)
        assert result == PendingReview.PROPOSAL_REVIEW

    async def test_plan_completed_returns_plan_review(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        change_id, db_path = await self._setup(
            db_session,
            tmp_path,
            current_stage="plan",
            completed_stages=["brainstorm", "plan"],
        )
        with (
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path",
                new=_make_resolver(db_path),
            ),
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path_fallback",
                new=_make_resolver(None),
            ),
        ):
            svc = StageProjectionService(db_session)
            result = await svc.compute_pending_review(db_session, change_id)
        assert result == PendingReview.PLAN_REVIEW

    async def test_verify_completed_returns_human_test(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        change_id, db_path = await self._setup(
            db_session,
            tmp_path,
            current_stage="verify",
            completed_stages=["brainstorm", "plan", "verify"],
        )
        with (
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path",
                new=_make_resolver(db_path),
            ),
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path_fallback",
                new=_make_resolver(None),
            ),
        ):
            svc = StageProjectionService(db_session)
            result = await svc.compute_pending_review(db_session, change_id)
        assert result == PendingReview.HUMAN_TEST

    async def test_archive_in_progress_returns_archive_confirm(
        self, db_session: AsyncSession, tmp_path: Path
    ):
        # archive 进行中（未 completed）→ archive_confirm
        change_id, db_path = await self._setup(
            db_session,
            tmp_path,
            current_stage="archive",
            completed_stages=["brainstorm", "plan", "verify"],
        )
        with (
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path",
                new=_make_resolver(db_path),
            ),
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path_fallback",
                new=_make_resolver(None),
            ),
        ):
            svc = StageProjectionService(db_session)
            result = await svc.compute_pending_review(db_session, change_id)
        assert result == PendingReview.ARCHIVE_CONFIRM

    async def test_no_completed_stage_returns_none(self, db_session: AsyncSession, tmp_path: Path):
        # execute 进行中，无任何门待审 → None
        change_id, db_path = await self._setup(
            db_session,
            tmp_path,
            current_stage="execute",
            completed_stages=["brainstorm", "plan"],
        )
        with (
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path",
                new=_make_resolver(db_path),
            ),
            patch.object(
                SillySpecStageDispatchService,
                "_resolve_db_path_fallback",
                new=_make_resolver(None),
            ),
        ):
            svc = StageProjectionService(db_session)
            result = await svc.compute_pending_review(db_session, change_id)
        assert result is None


def _make_resolver(db_path: Path | None):
    """构造一个替换 _resolve_db_path[_fallback] 的 async 方法工厂。

    返回 ``Path | None``，None 时表示该候选路径不可用。
    """

    async def _resolve(self, session, change):
        return Path(str(db_path)) if db_path else None

    return _resolve
