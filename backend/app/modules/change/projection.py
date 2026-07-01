"""Stage → PendingReview 只读投影服务（D-004@v2）。

基于 sillyspec.db 的 ``stages`` 表完成事件，把当前变更的人工门状态
投影成 4 个审核面板类型之一（proposal_review / plan_review /
human_test / archive_confirm），为 task-08 review 端点与 task-09
前端 GATE_PANELS 提供只读数据源。

设计要点（见 decisions.md D-004@v2）：

- spike-01 实证 sillyspec 仅 brainstorm 有 ``requiresWait`` 步骤，
  plan/execute/verify/archive 零 ``requiresWait``。故本服务 **不再查
  steps 表 waiting**，改为基于 ``stages.status == "completed"`` 事件
  投影，贴合工具 ``completeStep`` 不自动跳 stage（run.js:2819）的语义。
- 全程只读 sillyspec.db（``mode=ro``，uri=True），绝不写（D-002）。
- 投影是只读降级语义：db 不存在、change 不在 db、读取失败均返回
  ``None``，不抛异常。

映射表（D-004@v2）：

- brainstorm stage completed 且 current_stage 仍 brainstorm（或刚切到
  plan 但 plan 尚未 in_progress/completed）→ PROPOSAL_REVIEW
- plan stage completed 且 current_stage == plan → PLAN_REVIEW
- verify stage completed 且 current_stage == verify → HUMAN_TEST
- current_stage == archive（archive 进行中）→ ARCHIVE_CONFIRM
- 否则 → None
"""

from __future__ import annotations

import sqlite3
import uuid

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.change.dispatch import SillySpecStageDispatchService
from app.modules.change.model import Change
from app.modules.change.schema import PendingReview

log = get_logger(__name__)


class StageProjectionService:
    """把 sillyspec.db 的 stage 完成事件投影成 ``PendingReview``。

    单实例方法 ``compute_pending_review`` 纯只读：复用
    ``SillySpecStageDispatchService._resolve_db_path`` 解析 daemon
    sillyspec.db 路径，以 ``mode=ro`` 打开，按 D-004@v2 映射计算。
    """

    def __init__(self, session: AsyncSession) -> None:
        """Initialize the projection service.

        Args:
            session: SQLAlchemy async session（用于解析 sillyspec.db 路径
                与加载 Change 记录）。
        """
        self._session = session
        # 复用 dispatch 的 db 路径解析逻辑（task-05 已强化），避免重复实现。
        self._dispatch_svc = SillySpecStageDispatchService(session)

    async def compute_pending_review(
        self,
        session: AsyncSession,
        change_id: uuid.UUID,
    ) -> PendingReview | None:
        """计算变更当前等待的人工审核面板类型。

        Args:
            session: SQLAlchemy async session。
            change_id: 目标变更的 UUID。

        Returns:
            ``PendingReview`` 枚举值，或 ``None``（无等待审核 / db 缺失 /
            读取失败等降级场景）。绝不抛异常。
        """
        change = await session.get(Change, change_id)
        if change is None:
            log.warning("projection.change_not_found", change_id=str(change_id))
            return None

        db_path = await self._dispatch_svc._resolve_db_path(session, change)
        fallback_db_path = await self._dispatch_svc._resolve_db_path_fallback(session, change)
        if db_path is None or not db_path.is_file():
            if fallback_db_path and fallback_db_path.is_file():
                db_path = fallback_db_path
            else:
                log.info(
                    "projection.db_not_found",
                    change_id=str(change_id),
                    db_path=str(db_path) if db_path else None,
                )
                return None

        current_stage: str | None = None
        completed_stages: set[str] = set()
        conn: sqlite3.Connection | None = None
        try:
            conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            conn.row_factory = sqlite3.Row

            # changes.name 即 change_key（dispatch.py:1085 同款查询）。
            row = conn.execute(
                "SELECT current_stage FROM changes WHERE name = ?",
                (change.change_key,),
            ).fetchone()
            if (
                row is None
                and fallback_db_path
                and fallback_db_path.is_file()
                and db_path != fallback_db_path
            ):
                # Try fallback db (workspace root_path) — 与 dispatch.py:1089
                # 一致的两段式查询。
                conn.close()
                conn = sqlite3.connect(f"file:{fallback_db_path}?mode=ro", uri=True)
                conn.row_factory = sqlite3.Row
                row = conn.execute(
                    "SELECT current_stage FROM changes WHERE name = ?",
                    (change.change_key,),
                ).fetchone()
            if row is None:
                log.info(
                    "projection.change_not_in_db",
                    change_key=change.change_key,
                    change_id=str(change_id),
                )
                return None

            current_stage = row["current_stage"]

            # 收集所有已完成的 stage（D-004@v2：基于 stage 完成事件投影）。
            stage_rows = conn.execute(
                "SELECT stage FROM stages "
                "WHERE change_id = (SELECT id FROM changes WHERE name = ?) "
                "AND status = 'completed'",
                (change.change_key,),
            ).fetchall()
            completed_stages = {r["stage"] for r in stage_rows}
        except sqlite3.Error as exc:
            log.info(
                "projection.db_read_failed",
                change_id=str(change_id),
                error=str(exc),
            )
            return None
        finally:
            if conn:
                conn.close()

        return self._map(current_stage, completed_stages)

    @staticmethod
    def _map(
        current_stage: str | None,
        completed_stages: set[str],
    ) -> PendingReview | None:
        """D-004@v2 映射：基于 (current_stage, completed_stages) 投影。

        防跨 stage 撞车：current_stage 必须匹配对应 stage 的边界，不可仅凭
        completed_stages 命中（避免 brainstorm completed 在后续阶段仍误报）。
        """
        if current_stage is None:
            return None

        # archive 进行中（未完成）→ 归档确认门
        if current_stage == "archive" and "archive" not in completed_stages:
            return PendingReview.ARCHIVE_CONFIRM

        # verify completed 且尚未推进到 archive → 人工验收门
        if current_stage == "verify" and "verify" in completed_stages:
            return PendingReview.HUMAN_TEST

        # plan completed 且尚未推进到 execute → plan 审核门
        if current_stage == "plan" and "plan" in completed_stages:
            return PendingReview.PLAN_REVIEW

        # brainstorm completed 且仍在 brainstorm（或刚切到 plan 但 plan
        # 未开始/完成）→ proposal 审核门。current_stage==brainstorm 直接命中；
        # 切到 plan 但 plan 未完成时，说明 brainstorm 末步刚过、plan 审核门
        # 尚未到来，仍属 proposal 审核窗口。
        if "brainstorm" in completed_stages and (
            current_stage == "brainstorm"
            or (current_stage == "plan" and "plan" not in completed_stages)
        ):
            return PendingReview.PROPOSAL_REVIEW

        return None
