"""存量变更标题回填服务单测（2026-10-16-change-title-condense-backfill task-03）。

覆盖选中规则（兜底形态/超长/语义短句/无描述/deleted 排除）、提炼回填、
dry-run 零写库、幂等重跑——FR-03 行为锚。脚本侧（scripts/backfill_change_titles.py）
是薄执行器，事务控制流沿用 backfill_run_change_context.py 先例不另测。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from app.modules.change.title_backfill import TitleBackfillService

#: 轻量行实证长句（旧版 CLI 50 字硬截产物，非兜底形态——超长规则命中面）
_LONG_BLOB = (
    "change 文件树「刷新」同步链路三层静默失败"
    "——后端 RPC 预算 3s 短于实测 6~13.5s，需要把预算拉平到实测上限"
)


async def _make_workspace(db_session: Any) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-tbf-{uuid.uuid4().hex[:8]}",
        slug=f"ws-tbf-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-tbf-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws.id


async def _seed_change(
    db_session: Any,
    ws_id: uuid.UUID,
    *,
    key: str,
    title: str | None,
    description: str | None,
    location: str = "active",
) -> None:
    from app.modules.change.model import Change

    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=key,
            title=title,
            description=description,
            status="active",
            location=location,
            path=f"changes/{key}",
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _get_title(db_session: Any, ws_id: uuid.UUID, key: str) -> str | None:
    from sqlalchemy import select

    from app.modules.change.model import Change

    row = (
        (
            await db_session.execute(
                select(Change).where(Change.workspace_id == ws_id, Change.change_key == key)
            )
        )
        .scalars()
        .one()
    )
    await db_session.refresh(row)
    return row.title


class TestTitleBackfillService:
    async def test_fallback_title_backfilled_from_description(self, db_session) -> None:
        """兜底 title（等于 key）+ 动机散文 description → 提炼回填，description 不动。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-fallback"
        desc = "用户报告“登录的账户有时候莫名其妙被退出登录”。排查定位两个代码层根因并按方案 A 修复"
        await _seed_change(db_session, ws_id, key=key, title=key, description=desc)
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.selected == 1 and stats.updated == 1
        assert stats.details[0].new_title == "用户报告“登录的账户有时候莫名其妙被退出登录”"
        assert await _get_title(db_session, ws_id, key) == (
            "用户报告“登录的账户有时候莫名其妙被退出登录”"
        )

    async def test_long_semantic_title_backfilled(self, db_session) -> None:
        """超长语义 title（非兜底形态）同样命中超长规则被提炼。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-long"
        await _seed_change(db_session, ws_id, key=key, title=_LONG_BLOB, description=_LONG_BLOB)
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.updated == 1
        assert stats.details[0].new_title == "change 文件树「刷新」同步链路三层静默失败"

    async def test_semantic_short_title_untouched(self, db_session) -> None:
        """语义短 title（非兜底、≤30 字）不选中。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-semantic"
        await _seed_change(
            db_session, ws_id, key=key, title="奖惩模块执行清单", description="别的描述"
        )
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.selected == 0 and stats.updated == 0
        assert await _get_title(db_session, ws_id, key) == "奖惩模块执行清单"

    async def test_no_description_skipped(self, db_session) -> None:
        """兜底 title 但 description 为 NULL → 跳过计数，title 不变。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-nodesc"
        await _seed_change(db_session, ws_id, key=key, title=key, description=None)
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.selected == 1 and stats.skipped_no_description == 1
        assert stats.updated == 0
        assert await _get_title(db_session, ws_id, key) == key

    async def test_condense_same_value_skipped(self, db_session) -> None:
        """提炼结果与现 title 相同 → 跳过计数（不产生无意义写）。

        构造：title=兜底 key 形态，description 弱边界（冒号）前缀恰为 key——
        提炼结果与现 title 相同，走 skipped_empty_or_same 而非 updated。
        """
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-same"
        desc = "2026-10-16-tbf-same：清偿跨变更存量债的收尾与跨仓对账等后续动作"
        await _seed_change(db_session, ws_id, key=key, title=key, description=desc)
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.skipped_empty_or_same == 1 and stats.updated == 0
        assert await _get_title(db_session, ws_id, key) == key

    async def test_dry_run_counts_but_no_write(self, db_session) -> None:
        """dry-run：计数与 apply 同口径，title 零改写。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-dry"
        await _seed_change(
            db_session,
            ws_id,
            key=key,
            title=key,
            description="修复登录态莫名失效的问题，涉及前后端两侧根因。已逐一定位修复完毕",
        )
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=False)
        assert stats.updated == 1
        assert stats.details[0].new_title == "修复登录态莫名失效的问题，涉及前后端两侧根因"
        assert await _get_title(db_session, ws_id, key) == key, "dry-run 不得落库"

    async def test_idempotent_rerun_selects_zero(self, db_session) -> None:
        """回填后重跑：短句 title 非兜底且 ≤30 字 → 不再命中，全库零变化。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-idem"
        await _seed_change(db_session, ws_id, key=key, title=key, description=_LONG_BLOB)
        svc = TitleBackfillService(db_session)
        first = await svc.backfill_workspace(ws_id, apply=True)
        assert first.updated == 1
        second = await svc.backfill_workspace(ws_id, apply=True)
        assert second.selected == 0 and second.updated == 0

    async def test_deleted_location_excluded(self, db_session) -> None:
        """location='deleted' 行不进扫描面（防复活守卫语义不搅动）。"""
        ws_id = await _make_workspace(db_session)
        key = "2026-10-16-tbf-deleted"
        await _seed_change(
            db_session, ws_id, key=key, title=key, description="某描述", location="deleted"
        )
        stats = await TitleBackfillService(db_session).backfill_workspace(ws_id, apply=True)
        assert stats.scanned == 0 and stats.selected == 0
        assert await _get_title(db_session, ws_id, key) == key

    async def test_workspace_isolation(self, db_session) -> None:
        """按 workspace_id 过滤：另一工作区的同 key 行不被触碰。"""
        ws_a = await _make_workspace(db_session)
        ws_b = await _make_workspace(db_session)
        key = "2026-10-16-tbf-iso"
        await _seed_change(db_session, ws_a, key=key, title=key, description=_LONG_BLOB)
        await _seed_change(db_session, ws_b, key=key, title=key, description=_LONG_BLOB)
        await TitleBackfillService(db_session).backfill_workspace(ws_a, apply=True)
        assert await _get_title(db_session, ws_a, key) == (
            "change 文件树「刷新」同步链路三层静默失败"
        )
        assert await _get_title(db_session, ws_b, key) == key, "未定向工作区不得被触碰"
