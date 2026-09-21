"""knowledge_hits 数据底座：daemon 上行接收（幂等）+ 运营指标实时聚合。

change 2026-09-20-knowledge-effect-panel task-01 / Wave 1：

- ``knowledge_hits`` 表（行 sha256 幂等去重，多端单工作区零重复 D-007）；
- :meth:`HitsService.ingest_batch` 接收 daemon 增量上行 jsonl 行（坏行跳过
  计数、type 白名单外宽容落库不计数）；
- :meth:`HitsService.stats` 条目全集（parser helper）× 命中聚合
  （{inject, fr-inject} 拆锚点）→ 覆盖率/死条目/密度/生效速度/使用率榜/
  文件级计数（D-009/D-008@v3 口径，实时聚合不物化）。
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import uuid
from collections import Counter
from datetime import UTC, datetime, timedelta

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Index, String, Text, Uuid, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import Field

from app.models.base import BaseModel
from app.modules.knowledge.parser import parse_knowledge_entries
from app.modules.knowledge.schema import (
    CoverageOut,
    CoverageTrendPoint,
    DeadEntryOut,
    DensityOut,
    DensityTrendPoint,
    EntryCountItem,
    FreshnessOut,
    HitsBatchOut,
    KnowledgeStatsOut,
    UsageBoardItem,
)
from app.modules.knowledge.service import KnowledgeService
from app.modules.workspace.service import WorkspaceService

#: type 白名单（hits 实测形态）：五型遥测 inject/fr-inject/fr-duplicate-warning/
#: fr-supersede/fr-unreferenced + classify（归类审计，knowledge-classify.js 落盘）。
#: 白名单外仍落库存原值（宽容前向，CLI 新增型不丢数据），仅不进使用计数。
HIT_TYPES: frozenset[str] = frozenset(
    {
        "inject",
        "fr-inject",
        "fr-duplicate-warning",
        "fr-supersede",
        "fr-unreferenced",
        "classify",
    }
)

#: 使用计数口径：agent 注入语义的两型（D-002@v3）；其余型仅存档。
USAGE_TYPES: frozenset[str] = frozenset({"inject", "fr-inject"})

#: 死条目窗口：90 天零命中或从未命中（design D-009）。
DEAD_ENTRY_DAYS = 90
#: 生效速度窗口：近 30 天新增条目。
FRESHNESS_DAYS = 30
#: 趋势回溯周数。
TREND_WEEKS = 8


class KnowledgeHit(BaseModel, table=True):
    """单条知识命中遥测行（daemon 上行的 jsonl 行结构化落库）。

    ``line_hash`` = 原始行 sha256（行级原样哈希，多端一致），uq(workspace_id,
    line_hash) 数据库级幂等（R-02 并发竞态兜底）；``daemon_local_id`` body
    显式携带的 daemon 实例 id，原样落库不 FK；``matched_anchors`` = 行内
    ``matchedFiles`` 原样数组（``文件#锚`` / 裸文件两形态，聚合时拆）。
    """

    __tablename__ = "knowledge_hits"
    __table_args__ = (
        Index("uq_knowledge_hits_ws_hash", "workspace_id", "line_hash", unique=True),
        Index("ix_knowledge_hits_ws_time", "workspace_id", "occurred_at"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    workspace_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    line_hash: str = Field(sa_column=Column(String(64), nullable=False))
    daemon_local_id: str | None = Field(default=None, sa_column=Column(String(64), nullable=True))
    type: str = Field(sa_column=Column(String(32), nullable=False))
    change_name: str | None = Field(default=None, sa_column=Column(String(255), nullable=True))
    query_text: str | None = Field(default=None, sa_column=Column(Text, nullable=True))
    matched_anchors: list[str] | None = Field(default=None, sa_column=Column(JSON, nullable=True))
    occurred_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    received_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


def _aware_utc(dt: datetime) -> datetime:
    """DB 回读时间归一 aware-UTC（SQLite DateTime 不保 tz，naive 补 UTC 与
    PG/解析值同域比较，防 TypeError）。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _parse_occurred_at(value: object, fallback: datetime) -> datetime:
    """行内 ``at`` 字段 ISO 8601 解析；缺失/不可解析 → 接收时刻兜底。"""
    if isinstance(value, str) and value:
        try:
            parsed = datetime.fromisoformat(value)
        except ValueError:
            return fallback
        return _aware_utc(parsed)
    return fallback


class HitsService:
    """命中接收与运营指标聚合（无状态，实时计算）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._ws_service = WorkspaceService(session)
        # 复用 KnowledgeService 的 spec 根解析（platform-managed spec_root 优先、
        # root_path/.sillyspec 兜底，同口径——条目全集与文件列表读同一棵树）。
        self._knowledge_service = KnowledgeService(session)

    # ── 接收 ────────────────────────────────────────────────────────────────

    async def ingest_batch(
        self,
        workspace_id: uuid.UUID,
        lines: list[str],
        daemon_local_id: str | None = None,
    ) -> HitsBatchOut:
        """逐行解析落库（幂等）：坏行跳过计数、hash 冲突计 duplicates。

        幂等写法循仓内跨方言主流先例（20260918150000 幂等范式注释：先 SELECT
        判存再插入，避开 PG/SQLite 的 ON CONFLICT 方言分叉），uq 唯一约束兜底
        并发竞态（R-02）——撞约束整批回滚后逐行 savepoint 重放。
        """
        # 未知 workspace → WorkspaceNotFound（404，与模块内其它端点同语义，
        # 不落悬空 FK 行）。
        await self._ws_service.get(workspace_id)
        now = datetime.now(UTC)
        ingested = 0
        skipped_bad = 0
        duplicates = 0

        rows: list[KnowledgeHit] = []
        seen_hashes: set[str] = set()
        for raw in lines:
            try:
                obj = json.loads(raw)
            except ValueError:
                skipped_bad += 1
                continue
            if not isinstance(obj, dict):
                skipped_bad += 1
                continue
            # sha256(原始行)：行级原样哈希，与 daemon 端断点重报天然一致。
            line_hash = hashlib.sha256(raw.encode("utf-8")).hexdigest()
            if line_hash in seen_hashes:
                # 同批重复行（未提交，SELECT 判存看不到）直接计重。
                duplicates += 1
                continue
            seen_hashes.add(line_hash)
            rows.append(self._build_row(workspace_id, obj, line_hash, daemon_local_id, now))

        if rows:
            existing = set(
                (
                    await self._session.execute(
                        select(KnowledgeHit.line_hash).where(
                            KnowledgeHit.workspace_id == workspace_id,
                            KnowledgeHit.line_hash.in_([r.line_hash for r in rows]),
                        )
                    )
                )
                .scalars()
                .all()
            )
            fresh = [r for r in rows if r.line_hash not in existing]
            duplicates += len(rows) - len(fresh)
            if fresh:
                landed = await self._insert_all(fresh)
                ingested = landed
                duplicates += len(fresh) - landed
        return HitsBatchOut(ingested=ingested, skipped_bad=skipped_bad, duplicates=duplicates)

    async def _insert_all(self, fresh: list[KnowledgeHit]) -> int:
        """批量插入 + 并发竞态兜底（IntegrityError → 逐行 savepoint 重放）。

        返回实际落库行数；竞态撞唯一约束的行由调用侧经返回差值计 duplicates
        （fresh 总数 - 落库数）。
        """
        self._session.add_all(fresh)
        try:
            await self._session.commit()
            return len(fresh)
        except IntegrityError:
            # 并发窗口撞 uq 约束（两 daemon 同行同刻上行）：整批回滚后逐行
            # savepoint 重放，撞约束行丢弃（= 数据库级幂等 D-007/R-02）。
            await self._session.rollback()
            landed = 0
            for row in fresh:
                try:
                    async with self._session.begin_nested():
                        self._session.add(row)
                    landed += 1
                except IntegrityError:
                    continue
            await self._session.commit()
            return landed

    @staticmethod
    def _build_row(
        workspace_id: uuid.UUID,
        obj: dict,
        line_hash: str,
        daemon_local_id: str | None,
        now: datetime,
    ) -> KnowledgeHit:
        """行对象 → 表行。type 白名单不在此过滤（宽容前向：外型存原值，stats
        侧仅 USAGE_TYPES 进计数）；matchedFiles → matched_anchors 原样数组。"""
        raw_type = obj.get("type")
        change = obj.get("change")
        query = obj.get("query")
        matched = obj.get("matchedFiles")
        return KnowledgeHit(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            line_hash=line_hash,
            daemon_local_id=daemon_local_id,
            # type 列 String(32)：截断到列宽（对齐 change_name[:255] 口径）。超长值在
            # PG 抛 DataError（22001，非 IntegrityError）会穿透 _insert_all 的并发兜底
            # 整批 500，且 daemon 上行按批推进无按行跳过 → 单条毒行永久卡死该工作区
            # 遥测（SQLite 测试不检列宽，故必须写入侧截断）。
            type=str(raw_type)[:32] if raw_type is not None else "",
            change_name=str(change)[:255] if change is not None else None,
            query_text=str(query) if query is not None else None,
            matched_anchors=(
                [str(a) for a in matched if a is not None] if isinstance(matched, list) else None
            ),
            occurred_at=_parse_occurred_at(obj.get("at"), now),
            received_at=now,
        )

    # ── 聚合 ────────────────────────────────────────────────────────────────

    async def stats(self, workspace_id: uuid.UUID) -> KnowledgeStatsOut:
        """条目全集（parser helper）× 命中聚合 → 四指标 + 使用率榜 + 文件级计数。

        全指标只消费使用计数行（type∈{inject, fr-inject}）；其余型存档不进
        聚合。任务口径（D-008@v3 注记）：分母=inject 行 change_name 去重
        （fr-inject 行不进分母，仅其锚点计数；零命中任务不进 hits，次/任务
        系统性偏高为口径固有）。
        """
        now = _aware_utc(datetime.now(UTC))
        workspace = await self._ws_service.get(workspace_id)
        root = await self._knowledge_service._spec_content_root(workspace)
        # BQ-2 范式：同步 rglob+read 移线程池。
        entries = await asyncio.to_thread(parse_knowledge_entries, root)

        usage_rows = (
            await self._session.execute(
                select(
                    KnowledgeHit.type,
                    KnowledgeHit.change_name,
                    KnowledgeHit.matched_anchors,
                    KnowledgeHit.occurred_at,
                ).where(
                    KnowledgeHit.workspace_id == workspace_id,
                    KnowledgeHit.type.in_(USAGE_TYPES),
                )
            )
        ).all()

        # ── 锚点级 / 文件级 / 任务级基础聚合 ──
        anchor_total: Counter[str] = Counter()
        anchor_first: dict[str, datetime] = {}
        anchor_last: dict[str, datetime] = {}
        anchor_tasks: dict[str, set[str]] = {}
        file_counts: Counter[str] = Counter()
        inject_task_times: list[tuple[str, datetime]] = []
        # inject 行明细（occurred_at, 锚点数, change）——密度周窗口趋势数据源。
        inject_row_detail: list[tuple[datetime, int, str | None]] = []
        inject_anchor_total = 0

        for hit_type, change_name, matched, occurred_raw in usage_rows:
            occurred = _aware_utc(occurred_raw)
            anchors = matched or []
            for anchor in anchors:
                anchor_total[anchor] += 1
                first = anchor_first.get(anchor)
                if first is None or occurred < first:
                    anchor_first[anchor] = occurred
                last = anchor_last.get(anchor)
                if last is None or occurred > last:
                    anchor_last[anchor] = occurred
                if change_name:
                    anchor_tasks.setdefault(anchor, set()).add(str(change_name))
                file_counts[anchor.split("#", 1)[0]] += 1
            if hit_type == "inject":
                inject_anchor_total += len(anchors)
                inject_row_detail.append(
                    (occurred, tuple(anchors), str(change_name) if change_name else None)
                )
                if change_name:
                    inject_task_times.append((str(change_name), occurred))

        all_inject_tasks = {change for change, _ in inject_task_times}

        # 条目首见：frontmatter created_at 优先，hits 首见兜底（decisions 无
        # frontmatter 的口径，design Wave 1）；双缺 → None（存在期分母退化全期）。
        universe_created = {e.anchor: e.created_at for e in entries if e.created_at is not None}

        def _entry_first_seen(anchor: str) -> datetime | None:
            return universe_created.get(anchor) or anchor_first.get(anchor)

        def _period_task_count(first_seen: datetime | None) -> int:
            if first_seen is None:
                return len(all_inject_tasks)
            return len({c for c, t in inject_task_times if t >= first_seen})

        # ── coverage（+ 8 周趋势：分子按 occurred_at<=周末重算，分母恒当前总数）──
        total_entries = len(entries)
        hit_anchors = set(anchor_total)
        used_entries = sum(1 for e in entries if e.anchor in hit_anchors)
        week_ends = [now - timedelta(days=7 * k) for k in range(TREND_WEEKS - 1, -1, -1)]
        coverage_trend = [
            CoverageTrendPoint(
                week=week_end.date().isoformat(),
                pct=round(
                    sum(
                        1
                        for e in entries
                        if (first := anchor_first.get(e.anchor)) is not None and first <= week_end
                    )
                    / total_entries,
                    4,
                )
                if total_entries
                else 0.0,
            )
            for week_end in week_ends
        ]

        # ── dead_entries（90 天零命中或从未命中）──
        dead_cutoff = now - timedelta(days=DEAD_ENTRY_DAYS)
        dead_entries = [
            DeadEntryOut(anchor=e.anchor, last_hit_at=anchor_last.get(e.anchor))
            for e in entries
            if (last := anchor_last.get(e.anchor)) is None or last < dead_cutoff
        ]
        dead_entries.sort(key=lambda d: d.anchor)

        # ── density（ql-20260921-002 口径修正：每任务去重条目数）──
        # 此前=inject 行锚点次数和÷任务数——一个任务多轮注入同条目被重复计入
        # （实测 375 条/任务≈40 次注入×9 条），并非「注入过肥」。正确口径=每任务
        # 注入过的去重条目集合大小的均值（榜单口径同源：anchor_tasks 的任务维度对偶）。
        task_anchor_sets: dict[str, set[str]] = {}
        for _occ, _anchors, _chg in inject_row_detail:
            if _chg:
                task_anchor_sets.setdefault(_chg, set()).update(_anchors)
        density_avg = (
            round(sum(len(s) for s in task_anchor_sets.values()) / len(task_anchor_sets), 4)
            if task_anchor_sets
            else 0.0
        )
        density_trend: list[DensityTrendPoint] = []
        for week_end in week_ends:
            window_start = week_end - timedelta(days=7)
            window_rows = [r for r in inject_row_detail if window_start < r[0] <= week_end]
            # 窗口内每任务去重锚点集合，均值同主值口径
            window_task_anchors: dict[str, set[str]] = {}
            for _occ, _anchors, _chg in window_rows:
                if _chg:
                    window_task_anchors.setdefault(_chg, set()).update(_anchors)
            density_trend.append(
                DensityTrendPoint(
                    week=week_end.date().isoformat(),
                    per_task_avg=round(
                        sum(len(s) for s in window_task_anchors.values())
                        / len(window_task_anchors),
                        4,
                    )
                    if window_task_anchors
                    else 0.0,
                )
            )

        # ── freshness（近 30 天新增条目与其中被命中）──
        fresh_cutoff = now - timedelta(days=FRESHNESS_DAYS)
        recent_entries = [
            e for e in entries if (fs := _entry_first_seen(e.anchor)) and fs >= fresh_cutoff
        ]
        recent_used = sum(1 for e in recent_entries if e.anchor in hit_anchors)

        # ── usage_board（全量按 per_task 降序；零命中条目不入榜——死条目清单
        # ── usage_board（全量按 per_task 降序；零命中条目不入榜——死条目清单
        #    已覆盖零命中视角，榜只含有真实使用数据的锚点）──
        # ql-20260921-001 口径修正：per_task=任务渗透率（命中过该条目的任务数 ÷
        # 条目存在期任务总数）——此前分子用锚点命中次数（一个任务内同锚点被注入
        # 多次会被重复计入，次数可>任务数→渗透率>100% 出现 5033% 之类荒谬值）。
        # 渗透率天然 ∈[0,1]，前端 ×100 后即合法百分比；total 保留原始次数作副显。
        board: list[UsageBoardItem] = []
        for anchor, total in anchor_total.items():
            denom = _period_task_count(_entry_first_seen(anchor))
            hit_tasks = len(anchor_tasks.get(anchor, ()))
            board.append(
                UsageBoardItem(
                    anchor=anchor,
                    per_task=round(hit_tasks / denom, 4) if denom else 1.0,
                    total=total,
                    task_count=hit_tasks,
                    first_hit=anchor_first.get(anchor),
                    last_hit=anchor_last.get(anchor),
                )
            )
        board.sort(key=lambda b: (-b.per_task, -b.total, b.anchor))

        entry_counts = [
            EntryCountItem(file=file, count=count)
            for file, count in sorted(file_counts.items(), key=lambda kv: (-kv[1], kv[0]))
        ]

        return KnowledgeStatsOut(
            coverage=CoverageOut(
                used_entries=used_entries,
                total_entries=total_entries,
                trend=coverage_trend,
            ),
            dead_entries=dead_entries,
            density=DensityOut(per_task_avg=density_avg, trend=density_trend),
            freshness=FreshnessOut(recent_new=len(recent_entries), recent_used=recent_used),
            usage_board=board,
            entry_counts=entry_counts,
        )
