"""PlatformSyncService — 进度同步层业务（base_ts 字典序冲突检测 + 列表/详情）。

严格按跨仓契约 ``sillyhub-progress-sync-contract.md`` §4.2 算法：

- base_ts 空/缺失（None/空串）→ 无条件接受（首次同步/客户端无基准）
- ``stored > base_ts``（ISO 8601 UTC **字符串字典序** §7，不转 datetime）→ 409 冲突，
  返回平台当前完整 ``latest_progress`` 六表，**绝不 auto-merge**（§9 / D-006）
- 否则（stored None 或 stored ≤ base_ts）→ 接受 upsert

后端只存客户端 ``X-SillySpec-Pushed-At`` 原值（R-04：字典序前提，不自造时间戳）。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import PlatformChangeProgressORM


@dataclass
class PlatformSyncResult:
    """``upsert_progress`` 返回：冲突标志 + 平台当前完整 progress（冲突时供 409 body）。"""

    conflict: bool
    platform_progress: dict[str, Any] | None
    last_pushed_at: str | None


class PlatformSyncService:
    """进度同步聚合业务（change_name 全局唯一 PK，D-008，无 workspace 隔离）。

    service 在请求处理函数内实例化、注入 session（conventions：异步会话隔离）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def upsert_progress(
        self,
        name: str,
        body: dict[str, Any],
        base_ts: str | None,
        pushed_at: str | None,
        user: str | None,
    ) -> PlatformSyncResult:
        """契约 §4.2 base_ts 乐观锁冲突检测 + 接受 upsert。"""
        row = await self._session.get(PlatformChangeProgressORM, name)

        # 分支 1：base_ts 空/缺失（None 或空串）→ 首次同步/无基准，无条件接受
        if not base_ts:
            await self._apply(row, name, body, pushed_at, user)
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
        await self._apply(row, name, body, pushed_at, user)
        return PlatformSyncResult(conflict=False, platform_progress=None, last_pushed_at=None)

    async def _apply(
        self,
        row: PlatformChangeProgressORM | None,
        name: str,
        body: dict[str, Any],
        pushed_at: str | None,
        user: str | None,
    ) -> None:
        """接受分支：upsert latest_progress + 元字段（last_pushed_at/last_pusher）。"""
        if row is None:
            self._session.add(
                PlatformChangeProgressORM(
                    change_name=name,
                    latest_progress=body,
                    last_pushed_at=pushed_at,
                    last_pusher=user,
                )
            )
        else:
            row.latest_progress = body
            row.last_pushed_at = pushed_at
            row.last_pusher = user
        await self._session.commit()

    async def list_lightweight(self) -> list[dict[str, Any]]:
        """GET /changes 轻量列表（契约 §5）。

        ``current_stage`` 取自裸六表 ``latest_progress.changes[0].current_stage``
        （sync.js:592 客户端按键识别）。防御性 isinstance：裸 JSON 结构可能异常。
        """
        rows = (await self._session.execute(select(PlatformChangeProgressORM))).scalars().all()
        items: list[dict[str, Any]] = []
        for row in rows:
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

    async def get_progress(self, name: str) -> dict[str, Any] | None:
        """GET /changes/{name}/progress（契约 §6）：完整六表 + 顶层 ``last_pushed_at``。

        不存在返回 None（router 层 404，对齐 main.py quick_chat 惯例）。
        """
        row = await self._session.get(PlatformChangeProgressORM, name)
        if row is None:
            return None
        progress: dict[str, Any] = dict(row.latest_progress or {})
        progress["last_pushed_at"] = row.last_pushed_at
        return progress
