"""存量变更标题回填服务（2026-10-16-change-title-condense-backfill）。

变更中心两类烂标题的病根在 CLI 侧（完整变更=变更名兜底、轻量变更=「--input
首行 50 字硬截」长句），平台侧负责存量修复：``changes.description`` 列已存
动机段提取文本（2026-09-28-change-list-description，与 title 同源解析），是
现成的语义来源。选中规则：

- ``location IN ('active','archive')``——``deleted`` 行明确排除（防复活守卫
  语义不被搅动，deleted 行也不进任何列表展示面）；
- title 为兜底形态（``is_fallback_display_title``：空/等于 key/去日期前缀语义
  名/裸模板 H1 文本）**或** 长度 > ``TITLE_CONDENSE_MAX_LEN``（轻量长句病灶，
  非兜底形态也要提炼）；
- ``description`` 非空——无描述的老行跳过计数（纯 DB 面，不读工作区盘上
  proposal，读盘归 reparse 职责）。

新 title = ``condense_title(description)``：自然标点截断、约 20 字上限 30。
写集只有 ``changes.title`` 一列；调用方负责事务边界（本服务只改字段 + flush
不 commit，与 backfill_service 同约定）——dry-run 由脚本侧事务回滚保证零触碰。
幂等：回填后 title 为语义短句（非兜底、≤30 字），不再命中选中条件，重跑恒 0。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.model import Change
from app.modules.change.title_norm import (
    TITLE_CONDENSE_MAX_LEN,
    condense_title,
    is_fallback_display_title,
)


@dataclass
class TitleBackfillDetail:
    """单行命中明细（dry-run / apply 同口径收集，供脚本逐行打印核对）。"""

    change_key: str
    old_title: str | None
    new_title: str


@dataclass
class TitleBackfillStats:
    """单个工作区（或汇总）的回填计数（dry-run / apply 同口径上报）。"""

    scanned: int = 0
    #: 命中选中条件（title 兜底/超长）的行数
    selected: int = 0
    #: 实际改写 title 的行数（apply 与 dry-run 同口径——dry-run 也计数不落库）
    updated: int = 0
    #: 命中选中但 description 为空 → 无语义来源可提炼
    skipped_no_description: int = 0
    #: 有 description 但提炼结果为空或与现 title 相同
    skipped_empty_or_same: int = 0
    details: list[TitleBackfillDetail] = field(default_factory=list)

    def merge(self, other: TitleBackfillStats) -> None:
        self.scanned += other.scanned
        self.selected += other.selected
        self.updated += other.updated
        self.skipped_no_description += other.skipped_no_description
        self.skipped_empty_or_same += other.skipped_empty_or_same
        self.details.extend(other.details)


class TitleBackfillService:
    """存量行 title 回填（选中 → 提炼 → 改写；事务边界归调用方）。"""

    def __init__(self, db: AsyncSession):
        self._db = db

    async def backfill_workspace(
        self, workspace_id: uuid.UUID, *, apply: bool = False
    ) -> TitleBackfillStats:
        stats = TitleBackfillStats()
        rows = (
            (
                await self._db.execute(
                    select(Change).where(
                        col(Change.workspace_id) == workspace_id,
                        col(Change.location).in_(("active", "archive")),
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            stats.scanned += 1
            current = (row.title or "").strip()
            if not (
                is_fallback_display_title(current, row.change_key)
                or len(current) > TITLE_CONDENSE_MAX_LEN
            ):
                continue  # 语义短标题，不选中
            stats.selected += 1
            if not (row.description or "").strip():
                stats.skipped_no_description += 1
                continue
            new_title = condense_title(row.description)
            if not new_title or new_title == current:
                stats.skipped_empty_or_same += 1
                continue
            stats.details.append(
                TitleBackfillDetail(
                    change_key=row.change_key, old_title=row.title, new_title=new_title
                )
            )
            stats.updated += 1
            if apply:
                row.title = new_title
        if apply:
            await self._db.flush()
        return stats
