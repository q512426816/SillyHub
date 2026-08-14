"""PlatformSyncService — 进度同步层业务（workspace 隔离 + base_ts 字典序冲突检测）。

严格按跨仓契约 ``sillyhub-progress-sync-contract.md`` §4.2 算法：

- base_ts 空/缺失（None/空串）→ 无条件接受（首次同步/客户端无基准）
- ``stored > base_ts``（ISO 8601 UTC **字符串字典序** §7，不转 datetime）→ 409 冲突，
  返回平台当前完整 ``latest_progress`` 六表，**绝不 auto-merge**（§9 / D-006）
- 否则（stored None 或 stored ≤ base_ts）→ 接受 upsert

workspace 隔离（Change 2026-08-11-change-progress-projection task-06 / D-001@v1）：三方法
首位均带 ``workspace_id``，按 ``(workspace_id, change_name)`` 复合键读写。``workspace_id``
由 router 从 ``require_platform_sync`` token 派生注入（唯一通道，G6），service 内不猜测。
shk_live_ 过渡期 ``workspace_id=None`` → 用 ``is_(None)`` 过滤（SQL ``=`` 不匹配 NULL），
行为与旧版全局聚合等价（R-02）。

后端只存客户端 ``X-SillySpec-Pushed-At`` 原值（R-04：字典序前提，不自造时间戳）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.platform_sync.model import PlatformChangeProgressORM


@dataclass
class PlatformSyncResult:
    """``upsert_progress`` 返回：冲突标志 + 平台当前完整 progress（冲突时供 409 body）。"""

    conflict: bool
    platform_progress: dict[str, Any] | None
    last_pushed_at: str | None


class PlatformSyncService:
    """进度同步聚合业务（``(workspace_id, change_name)`` 复合键隔离，D-001@v1）。

    service 在请求处理函数内实例化、注入 session（conventions：异步会话隔离）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _find_row(
        self, workspace_id: uuid.UUID | None, name: str
    ) -> PlatformChangeProgressORM | None:
        """按复合键取行。``workspace_id=None`` 用 ``is_(None)``（SQL ``=`` 不匹配 NULL）。"""
        stmt = select(PlatformChangeProgressORM).where(
            col(PlatformChangeProgressORM.change_name) == name,
            col(PlatformChangeProgressORM.workspace_id).is_(None)
            if workspace_id is None
            else col(PlatformChangeProgressORM.workspace_id) == workspace_id,
        )
        return (await self._session.execute(stmt)).scalar_one_or_none()

    async def upsert_progress(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        body: dict[str, Any],
        base_ts: str | None,
        pushed_at: str | None,
        user: str | None,
    ) -> PlatformSyncResult:
        """契约 §4.2 base_ts 乐观锁冲突检测 + 接受 upsert（workspace 隔离）。"""
        row = await self._find_row(workspace_id, name)

        # 分支 1：base_ts 空/缺失（None 或空串）→ 首次同步/无基准，无条件接受
        if not base_ts:
            await self._apply(workspace_id, row, name, body, pushed_at, user)
            return PlatformSyncResult(conflict=False, platform_progress=None, last_pushed_at=None)

        # 分支 2：stored 存在 AND stored > base_ts（字符串字典序 §7）→ 冲突
        stored = row.last_pushed_at if row is not None else None
        if stored is not None and stored > base_ts:
            return PlatformSyncResult(
                conflict=True,
                platform_progress=row.latest_progress if row is not None else None,
                last_pushed_at=stored,
            )

        # 分支 3：base_ts 有效（stored None 或 stored ≤ base_ts）→ 接受
        await self._apply(workspace_id, row, name, body, pushed_at, user)
        return PlatformSyncResult(conflict=False, platform_progress=None, last_pushed_at=None)

    async def _apply(
        self,
        workspace_id: uuid.UUID | None,
        row: PlatformChangeProgressORM | None,
        name: str,
        body: dict[str, Any],
        pushed_at: str | None,
        user: str | None,
    ) -> None:
        """接受分支：upsert latest_progress + 元字段（last_pushed_at/last_pusher）。

        并发自愈：sillyspec 客户端新建 change 首推会并发双发，两请求的
        ``_find_row`` 都可能在对方 commit 前返回 None，于是双双走 INSERT，
        第二个 commit 撞复合唯一约束 ``uq_platform_change_progress_workspace_change``
        → 500。这里 catch ``IntegrityError`` 回退 UPDATE（跨方言：SQLite 测试库 /
        PG 生产都抛 IntegrityError，无需 ON CONFLICT 方言分支）。详见 ql-20260811-005-6881。
        """
        if row is not None:
            self._assign(row, body, pushed_at, user)
            await self._session.commit()
            return

        try:
            self._session.add(
                PlatformChangeProgressORM(
                    # 显式 id（D-001@v1 / R-02）：model default=uuid.uuid4 会兜底，
                    # 但显式传入语义更清晰、不依赖 default 触发时机。
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    latest_progress=body,
                    last_pushed_at=pushed_at,
                    last_pusher=user,
                    # D-003@v1 单写者：不传 documents/approval（ORM default None）。
                )
            )
            await self._session.commit()
        except IntegrityError:
            # 并发对手已抢先 INSERT 建行：rollback 清失败事务，重查行改走 UPDATE。
            # 新主键（id PK，D-001@v1 / design §5）下冲突源是 (workspace_id, change_name)
            # 复合唯一约束 uq_platform_change_progress_workspace_change（同 workspace 并发双发），
            # 而非 change_name 单主键；跨 workspace 同名各占一行、不再撞键。
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                # platform_sync 无删除路径，理论不发生；重抛让上层感知而非静默丢数据。
                raise
            self._assign(existing, body, pushed_at, user)
            await self._session.commit()

    @staticmethod
    def _assign(
        row: PlatformChangeProgressORM,
        body: dict[str, Any],
        pushed_at: str | None,
        user: str | None,
    ) -> None:
        """UPDATE 共用：定向列覆盖 latest_progress + 元字段 + 刷新 updated_at。

        D-003@v1 单写者（2026-08-14-platform-sync-docs-approval）：绝不触碰
        documents/approval 列（POST documents / POST approval 各自写）。
        """
        row.latest_progress = body
        row.last_pushed_at = pushed_at
        row.last_pusher = user
        row.updated_at = datetime.now(UTC)

    async def list_lightweight(self, workspace_id: uuid.UUID | None) -> list[dict[str, Any]]:
        """GET /changes 轻量列表（契约 §5，按 workspace 过滤）。

        ``current_stage`` 取自裸六表 ``latest_progress.changes[0].current_stage``
        （sync.js:592 客户端按键识别）。防御性 isinstance：裸 JSON 结构可能异常。
        ``workspace_id=None`` → shk_live_ 过渡期全局聚合（``is_(None)``）。
        """
        stmt = select(PlatformChangeProgressORM).where(
            col(PlatformChangeProgressORM.workspace_id).is_(None)
            if workspace_id is None
            else col(PlatformChangeProgressORM.workspace_id) == workspace_id,
        )
        rows = (await self._session.execute(stmt)).scalars().all()
        items: list[dict[str, Any]] = []
        for row in rows:
            # 占位行守卫（design §4.3 / Grill UB-1）：latest_progress 无值（仅
            # documents/approval 有值）的行不出现在列表——对 CLI pullList 维持
            # 「无进度」语义。用 Python 判断而非 SQL IS NOT NULL：SQLAlchemy JSON
            # 列缺省在 SQLite 落 JSON 编码的 'null' 字符串（非 SQL NULL），跨方言
            # SQL 过滤不可靠（task-05 实测抓到），ORM 读回 None 的语义判断才稳。
            if row.latest_progress is None:
                continue
            progress = row.latest_progress if isinstance(row.latest_progress, dict) else {}
            changes = progress.get("changes")
            first = changes[0] if isinstance(changes, list) and changes else {}
            current_stage = first.get("current_stage") if isinstance(first, dict) else None
            items.append(
                {
                    "name": row.change_name,
                    "current_stage": current_stage,
                    "last_pushed_at": row.last_pushed_at,
                    "last_pusher": row.last_pusher,
                }
            )
        return items

    async def get_progress(
        self, workspace_id: uuid.UUID | None, name: str
    ) -> dict[str, Any] | None:
        """GET /changes/{name}/progress（契约 §6，复合键取行）：完整六表 + 顶层 ``last_pushed_at``。

        不存在/跨 workspace → None（router 层 404，对齐 main.py quick_chat 惯例）。
        """
        row = await self._find_row(workspace_id, name)
        if row is None or row.latest_progress is None:
            # 占位行守卫（design §4.3 / Grill UB-1）：仅 documents/approval 有值的行
            # 视为「无进度」→ None（router 维持 404）。否则 CLI triggerPull 拉到
            # 200 空态经 pm.import 会清空本地进度库（progress.js DELETE stages 不重建）。
            return None
        progress: dict[str, Any] = dict(row.latest_progress or {})
        progress["last_pushed_at"] = row.last_pushed_at
        return progress

    # ── Change 2026-08-14-platform-sync-docs-approval task-03（D-002@v1 / D-003@v1 单写者）──

    async def upsert_documents(
        self, workspace_id: uuid.UUID | None, name: str, documents: dict[str, str]
    ) -> int:
        """POST /changes/{name}/documents：定向 upsert documents 列。

        行有 → UPDATE 只动 documents + updated_at；行无 → INSERT 占位
        （latest_progress NULL，下行端点由占位行守卫视为「无进度」）。
        IntegrityError 并发自愈与 ``_apply`` 同模式。
        """
        row = await self._find_row(workspace_id, name)
        if row is not None:
            row.documents = dict(documents)
            row.updated_at = datetime.now(UTC)
            await self._session.commit()
            return len(documents)
        try:
            self._session.add(
                PlatformChangeProgressORM(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    documents=dict(documents),
                )
            )
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                raise
            existing.documents = dict(documents)
            existing.updated_at = datetime.now(UTC)
            await self._session.commit()
        return len(documents)

    async def set_approval(
        self,
        workspace_id: uuid.UUID | None,
        name: str,
        decision: str,
        reason: str | None,
        decided_by: str,
    ) -> dict[str, Any]:
        """POST /changes/{name}/approval：定向写 approval 列（D-001@v1 完整闭环）。

        approval JSON = ``{status, reason, decided_at, decided_by}``；重复提交覆盖
        （后写赢）。行无 → INSERT 占位。
        """
        record: dict[str, Any] = {
            "status": decision,
            "reason": reason,
            "decided_at": datetime.now(UTC).isoformat(),
            "decided_by": decided_by,
        }
        row = await self._find_row(workspace_id, name)
        if row is not None:
            row.approval = record
            row.updated_at = datetime.now(UTC)
            await self._session.commit()
            return record
        try:
            self._session.add(
                PlatformChangeProgressORM(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    change_name=name,
                    approval=record,
                )
            )
            await self._session.commit()
        except IntegrityError:
            await self._session.rollback()
            existing = await self._find_row(workspace_id, name)
            if existing is None:
                raise
            existing.approval = record
            existing.updated_at = datetime.now(UTC)
            await self._session.commit()
        return record

    async def get_approval_record(
        self, workspace_id: uuid.UUID | None, name: str
    ) -> dict[str, Any] | None:
        """GET /changes/{name}/approval：读 approval 列。

        行不存在 / approval NULL（含仅 documents 的占位行）→ None——router 层
        映射默认 approved 放行（ql-20260812-001-6eb8 兼容语义）。
        """
        row = await self._find_row(workspace_id, name)
        if row is None:
            return None
        return row.approval if isinstance(row.approval, dict) else None
