"""Scan docs use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows.
"""

from __future__ import annotations

import asyncio
import hashlib
import uuid
from collections import Counter
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import yaml
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import load_only
from sqlmodel import col

from app.core.errors import ScanDocNotFound
from app.core.logging import get_logger
from app.modules.knowledge.hits import KnowledgeHit
from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
from app.modules.scan_docs.conflict_service import ScanDocConflictService
from app.modules.scan_docs.model import ScanDocument
from app.modules.scan_docs.parser import (
    STANDARD_DOC_TYPES,
    ParsedDoc,
    ScanDocsParser,
    ScanDocsResult,
)
from app.modules.scan_docs.schema import (
    ScanDocsCoverageOut,
    ScanDocsDensityOut,
    ScanDocsFreshnessOut,
    ScanDocsInjectionBoardItem,
    ScanDocsInjectionOut,
    ScanDocsRecentBoardItem,
    ScanDocsStaleDocOut,
    ScanDocsStatsOut,
    ScanDocsTrendPoint,
)
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

# ── stats 口径常量（2026-09-21-scan-docs-ops-panel design D-001@v1/D-003@v1）──
STATS_TREND_WEEKS = 8
STATS_STALE_DAYS = 90
STATS_FRESH_DAYS = 30
STATS_INJECTION_DAYS = 30
STATS_STALE_LIST_LIMIT = 200
STATS_BOARD_LIMIT = 10
#: docs-inject 遥测行 type 值（sillyspec CLI 模块上下文注入埋点，D-003@v1）。
STATS_INJECTION_TYPE = "docs-inject"


def _dt_equal(a: datetime | None, b: datetime | None) -> bool:
    """datetime 相等比较（时区归一）：SQLite 读回 naive（存的是 UTC），parsed 侧
    是 aware UTC——直接 != 恒不等，会让未变更行永远 dirty（ql-20260921-003）。"""
    if a is None or b is None:
        return a is None and b is None
    aa = a.replace(tzinfo=UTC) if a.tzinfo is None else a
    bb = b.replace(tzinfo=UTC) if b.tzinfo is None else b
    return aa == bb


def _as_utc(dt: datetime) -> datetime:
    """DB 回读时间归一 aware-UTC（SQLite 读回 naive 存的是 UTC；对齐
    knowledge/hits.py ``_aware_utc`` 同款坑的防御，stats 聚合比较前置）。"""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _strip_docs_prefix(path: str) -> str:
    """剥前导包裹段（可选 ``.sillyspec`` 段 + ``docs`` 段）。

    与前端 stripPathPrefix 同口径（frontend/src/lib/scan-docs-tree.ts）：扁平
    布局 ``docs/<项目>/...`` 与包裹布局 ``.sillyspec/docs/<项目>/...`` 都剥成
    ``<项目>/...``，剥后第一段即「项目」（无段的根级文件由调用方单独处理）。"""
    parts = path.split("/")
    start = 0
    if parts and parts[0] == ".sillyspec":
        start = 1
    if start < len(parts) and parts[start] == "docs":
        start += 1
    return "/".join(parts[start:])


class ScanDocsService:
    """List, fetch, and reparse scan documents for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ScanDocsParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ScanDocsParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # -- Queries ---

    async def list_(
        self,
        workspace_id: uuid.UUID,
        *,
        q: str | None = None,
    ) -> tuple[list[ScanDocument], int, dict[str, int]]:
        await self._workspace_service.get(workspace_id)
        stmt = (
            select(ScanDocument)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .where(col(ScanDocument.exists).is_(True))
        )
        if q:
            # 跨方言（PG/SQLite）大小写不敏感搜索：func.lower() + like + escape。
            # 转义用户输入中的通配符 %/_ 与转义符 \，避免被当作 LIKE 通配符。
            escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            pattern = f"%{escaped.lower()}%"
            stmt = stmt.where(
                or_(
                    func.lower(ScanDocument.path).like(pattern, escape="\\"),
                    func.lower(ScanDocument.title).like(pattern, escape="\\"),
                    func.lower(ScanDocument.content).like(pattern, escape="\\"),
                )
            )
        else:
            # task-04（性能）：无 q 时响应 schema（ScanDocSummary）本就不含 content，
            # load_only 排除 content 大列，列表页不再全量搬运文档正文；session 仍
            # attach，后续访问 content 会走懒加载补取（design D-001@v1 fallback 方案）。
            # 有 q 分支保持 SQL LIKE 现状（候选集二次取 content 严格劣于现状，不采用）。
            stmt = stmt.options(
                load_only(
                    ScanDocument.id,
                    ScanDocument.workspace_id,
                    ScanDocument.doc_type,
                    ScanDocument.path,
                    ScanDocument.title,
                    ScanDocument.exists,
                    ScanDocument.last_modified_at,
                    ScanDocument.source_member_id,
                    ScanDocument.source_runtime_id,
                    ScanDocument.source_synced_at,
                    ScanDocument.source_mtime,
                    ScanDocument.content_hash,
                )
            )
        stmt = stmt.order_by(col(ScanDocument.path).asc())
        items = list((await self._session.execute(stmt)).scalars().all())
        conflict_counts = await self._count_conflicts_batch(workspace_id, [d.path for d in items])
        return items, len(items), conflict_counts

    async def get(
        self,
        workspace_id: uuid.UUID,
        doc_id_or_type: uuid.UUID | str,
    ) -> ScanDocument:
        await self._workspace_service.get(workspace_id)
        if isinstance(doc_id_or_type, str):
            stmt = (
                select(ScanDocument)
                .where(col(ScanDocument.workspace_id) == workspace_id)
                .where(col(ScanDocument.doc_type) == doc_id_or_type)
            )
            doc = (await self._session.execute(stmt)).scalar_one_or_none()
        else:
            doc = await self._session.get(ScanDocument, doc_id_or_type)
            if doc is not None and doc.workspace_id != workspace_id:
                doc = None
        if doc is None:
            raise ScanDocNotFound(
                "扫描文档不存在，请先扫描工作区或刷新文档列表。",
                details={
                    "workspace_id": str(workspace_id),
                    "doc_id_or_type": str(doc_id_or_type),
                },
            )
        return doc

    # -- Stats（2026-09-21-scan-docs-ops-panel task-01）---

    async def stats(self, workspace_id: uuid.UUID) -> ScanDocsStatsOut:
        """scan_documents 单表内存聚合 → 覆盖率（两级）/陈旧/密度/新鲜/趋势/最近榜，
        再聚合 knowledge_hits 的 docs-inject 行出注入频次（D-003@v1）。

        量级前提（design R-05）：当前工作区数百行 exists 文档，一次轻列查询
        （排除 content）后全内存聚合，不写多条 SQL；_module-map.yaml 行单独
        SELECT content 解析登记模块数（yaml 损坏按无 map 退化，不抛 500）。
        """
        await self._workspace_service.get(workspace_id)
        now = _as_utc(datetime.now(UTC))

        stmt = (
            select(ScanDocument.path, ScanDocument.doc_type, ScanDocument.last_modified_at)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .where(col(ScanDocument.exists).is_(True))
        )
        # (raw_path, doc_type, mtime_aware|None)：mtime 归一 aware-UTC——SQLite 读回
        # naive，与 aware 的 now/窗口比较裸混用会 TypeError。
        docs: list[tuple[str, str, datetime | None]] = [
            (path, doc_type, _as_utc(mtime) if mtime is not None else None)
            for path, doc_type, mtime in (await self._session.execute(stmt)).all()
        ]

        # ── 项目分组：剥前缀后第一段 = 项目；根级文件不建项目（只进全局口径）──
        # 两个平行 dict 而非异构 dict[str, X|Y]——保持值类型单一，mypy 零窄化负担。
        std_types_by_project: dict[str, set[str]] = {}
        module_md_by_project: dict[str, int] = {}
        for raw_path, doc_type, _mtime in docs:
            segs = _strip_docs_prefix(raw_path).split("/")
            if len(segs) < 2:
                continue
            std_types_by_project.setdefault(segs[0], set())
            module_md_by_project.setdefault(segs[0], 0)
            if segs[1] == "scan" and doc_type in STANDARD_DOC_TYPES:
                # 按项目去重：scan/ 下同名标准件（异常多副本）只计一次。
                std_types_by_project[segs[0]].add(doc_type)
            if segs[1] == "modules" and raw_path.endswith(".md") and segs[-1] != "_module-map.yaml":
                module_md_by_project[segs[0]] += 1

        # ── 覆盖率两级：七件套 have/expected + 模块层 have/expected ──
        std_have = sum(len(types) for types in std_types_by_project.values())
        std_expected = len(std_types_by_project) * len(STANDARD_DOC_TYPES)
        module_have = sum(module_md_by_project.values())
        # 无 map / map 损坏的项目 expected 退化为该项目 have（不虚摊覆盖率分母）。
        registered = await self._registered_module_counts(workspace_id, set(std_types_by_project))
        module_expected = sum(
            registered.get(proj, module_md_by_project.get(proj, 0)) for proj in std_types_by_project
        )

        # ── 陈旧：mtime 为空或 < now-90d；清单升序（None 最前），上限 200 ──
        stale_cutoff = now - timedelta(days=STATS_STALE_DAYS)
        epoch = datetime.min.replace(tzinfo=UTC)
        stale = [d for d in docs if d[2] is None or d[2] < stale_cutoff]
        stale.sort(key=lambda d: (d[2] is not None, d[2] or epoch))

        # ── 密度 / 新鲜 ──
        total = len(docs)
        fresh_cutoff = now - timedelta(days=STATS_FRESH_DAYS)
        recent_updated = sum(1 for d in docs if d[2] is not None and d[2] >= fresh_cutoff)

        # ── 趋势：近 8 个自然周（周一为界）桶内 mtime 计数，8 点全输出含 0 ──
        this_monday = now.date() - timedelta(days=now.date().weekday())
        mondays = [this_monday - timedelta(weeks=k) for k in range(STATS_TREND_WEEKS - 1, -1, -1)]
        week_counts: Counter[date] = Counter()
        for _raw_path, _doc_type, mtime in docs:
            if mtime is None:
                continue
            week_counts[mtime.date() - timedelta(days=mtime.date().weekday())] += 1
        trend = [
            ScanDocsTrendPoint(week=w.isoformat(), updated=week_counts.get(w, 0)) for w in mondays
        ]

        # ── 最近更新榜：mtime 非空降序 Top 10（先按 path 排再稳定排序 → 同刻 path 升序）──
        dated = sorted((d for d in docs if d[2] is not None), key=lambda d: d[0])
        dated.sort(key=lambda d: d[2] or epoch, reverse=True)
        recent_board = [
            ScanDocsRecentBoardItem(path=raw_path, doc_type=doc_type, last_modified_at=mtime)
            for raw_path, doc_type, mtime in dated[:STATS_BOARD_LIMIT]
        ]

        return ScanDocsStatsOut(
            coverage=ScanDocsCoverageOut(
                std_have=std_have,
                std_expected=std_expected,
                module_have=module_have,
                module_expected=module_expected,
                trend=trend,
            ),
            stale_docs=[
                ScanDocsStaleDocOut(path=raw_path, doc_type=doc_type, last_modified_at=mtime)
                for raw_path, doc_type, mtime in stale[:STATS_STALE_LIST_LIMIT]
            ],
            density=ScanDocsDensityOut(per_project_avg=total / max(len(std_types_by_project), 1)),
            freshness=ScanDocsFreshnessOut(recent_updated=recent_updated, total=total),
            recent_board=recent_board,
            injection=await self._injection_stats(workspace_id, now),
        )

    async def _registered_module_counts(
        self,
        workspace_id: uuid.UUID,
        projects: set[str],
    ) -> dict[str, int]:
        """各项目 ``_module-map.yaml`` 登记模块数（yaml.safe_load 取 ``modules:``
        字典条目数）。无 map / 内容损坏 / 字段缺失的项目不进返回字典——调用方按
        「无 map 退化为实有」处理，不抛 500（design 兼容策略）。
        """
        if not projects:
            return {}
        stmt = (
            select(ScanDocument.path, ScanDocument.content)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .where(col(ScanDocument.exists).is_(True))
            .where(col(ScanDocument.path).endswith("_module-map.yaml"))
        )
        registered: dict[str, int] = {}
        for raw_path, content in (await self._session.execute(stmt)).all():
            segs = _strip_docs_prefix(raw_path).split("/")
            if len(segs) < 2 or segs[0] not in projects:
                continue
            try:
                data = yaml.safe_load(content or "")
            except yaml.YAMLError:
                continue
            modules = data.get("modules") if isinstance(data, dict) else None
            if isinstance(modules, dict):
                registered[segs[0]] = len(modules)
        return registered

    async def _injection_stats(
        self,
        workspace_id: uuid.UUID,
        now: datetime,
    ) -> ScanDocsInjectionOut:
        """knowledge_hits 的 docs-inject 行聚合（近 30 天窗口，D-003@v1）。

        跨模块只读引用 KnowledgeHit（对齐 spec_workspace 引 ScanDocument 先例；
        knowledge 链不反向依赖本模块，无循环 import）。时间过滤在 Python 侧做
        ——对齐 hits.stats 先例：occurred_at 读回 naive/aware 混布，SQL 侧跨方言
        字符串比较有陷阱，且单 type 遥测行量级小。USAGE_TYPES 白名单不含
        docs-inject，知识库 stats 口径天然不被本查询影响（design R-07）。
        """
        window_start = now - timedelta(days=STATS_INJECTION_DAYS)
        stmt = select(KnowledgeHit.matched_anchors, KnowledgeHit.occurred_at).where(
            KnowledgeHit.workspace_id == workspace_id,
            KnowledgeHit.type == STATS_INJECTION_TYPE,
        )
        total_30d = 0
        path_counts: Counter[str] = Counter()
        for anchors, occurred_raw in (await self._session.execute(stmt)).all():
            if _as_utc(occurred_raw) < window_start:
                continue
            total_30d += 1
            # matched_anchors = 行内 matchedFiles 原样数组（docs 相对路径，可能是
            # docs/... 或 .sillyspec/docs/... 两种布局前缀），剥前缀对齐树口径。
            for anchor in anchors or []:
                stripped = _strip_docs_prefix(str(anchor))
                if stripped:
                    path_counts[stripped] += 1
        board = [
            ScanDocsInjectionBoardItem(path=path, hits_30d=hits)
            for path, hits in sorted(path_counts.items(), key=lambda kv: (-kv[1], kv[0]))[
                :STATS_BOARD_LIMIT
            ]
        ]
        return ScanDocsInjectionOut(
            total_30d=total_30d,
            docs_hit_30d=len(path_counts),
            board=board,
        )

    # -- Conflict history (D-001@V1) ---

    async def count_conflicts(self, workspace_id: uuid.UUID, path: str) -> int:
        """单路径历史冲突条数（用于详情页徽章）。"""
        stmt = (
            select(func.count())
            .select_from(ScanDocConflictHistory)
            .where(col(ScanDocConflictHistory.workspace_id) == workspace_id)
            .where(col(ScanDocConflictHistory.path) == path)
        )
        return int((await self._session.execute(stmt)).scalar_one())

    async def list_conflicts(
        self,
        workspace_id: uuid.UUID,
        doc_id: uuid.UUID,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ScanDocConflictHistory]:
        """某文档的历史冲突归档，按 created_at 倒序。doc 不存在抛 ScanDocNotFound。"""
        doc = await self.get(workspace_id, doc_id)
        return await ScanDocConflictService(self._session).list_history(
            workspace_id,
            doc.path,
            limit=limit,
            offset=offset,
        )

    async def _count_conflicts_batch(
        self,
        workspace_id: uuid.UUID,
        paths: list[str],
    ) -> dict[str, int]:
        """批量算 path→conflict_count（一次 group by，避免列表 N+1）。"""
        if not paths:
            return {}
        cnt_stmt = (
            select(ScanDocConflictHistory.path, func.count())
            .where(col(ScanDocConflictHistory.workspace_id) == workspace_id)
            .where(col(ScanDocConflictHistory.path).in_(paths))
            .group_by(ScanDocConflictHistory.path)
        )
        return {row[0]: int(row[1]) for row in (await self._session.execute(cnt_stmt)).all()}

    # -- Reparse ---

    async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ScanDocsResult]:
        """Reparse all docs under .sillyspec/docs/ for a workspace."""
        workspace = await self._workspace_service.get(workspace_id)

        # 平台 specRoot 有镜像数据就读（任意 strategy：platform-managed/repo-native/repo-mirrored）。
        # 旧逻辑只 platform-managed 读 spec_root，导致 repo-native/repo-mirrored 读 root_path
        # （daemon-client 客户端路径容器内不可达）→ DOCS_DIR_MISSING → 扫描文档不显示。
        # task-09（2026-07-10-remove-server-local-workspace-mode）：单一 daemon-client 后
        # platform_managed 恒 True（扁平布局），删 is_daemon_client_path_source 判定。
        sillyspec_root = Path(workspace.root_path)
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws_svc = SpecWorkspaceService(self._session)
            spec_ws = await spec_ws_svc.get(workspace.id)
            if spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
        except Exception:
            pass

        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}

        if not workspace.component_key:
            # Parent workspace — parse the entire docs tree recursively
            # task-01（性能）：parse_docs_tree 递归遍历 docs 树（同步重 FS IO）移到线程，
            # 解析期间事件循环可服务并发请求（design D-002@v1）；parser 纯同步纯读
            # 无共享可变状态，线程安全（design R-01）。
            result = await asyncio.to_thread(
                self._parser.parse_docs_tree, sillyspec_root, platform_managed=True
            )
        else:
            result = await asyncio.to_thread(
                self._parser.parse_component,
                sillyspec_root,
                workspace.component_key,
                platform_managed=True,
            )
        stats["parsed"] = len([d for d in result.docs if d.exists])

        # Fetch existing rows keyed by path
        existing = await self._fetch_existing(workspace_id=workspace_id)
        existing_by_path: dict[str, ScanDocument] = {d.path: d for d in existing}
        parsed_paths: set[str] = set()

        for parsed_doc in result.docs:
            if not parsed_doc.exists:
                continue
            parsed_paths.add(parsed_doc.path)

            if parsed_doc.path in existing_by_path:
                row = existing_by_path[parsed_doc.path]
                self._apply_parsed(row, parsed_doc)
                stats["updated"] += 1
            else:
                row = self._build_row(parsed_doc, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1

        # Soft-delete rows whose files disappeared
        for row in existing:
            if row.path not in parsed_paths:
                row.exists = False
                row.content = None
                stats["deleted"] += 1

        await self._session.commit()
        log.info("scan_docs.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    # -- Helpers ---

    async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ScanDocument]:
        # reparse 每次进页面都会跑：existing 行的旧 content 在本流程只被整体覆盖
        # （_apply_parsed 赋新值 / 软删置 None），从不读取——load_only 排除 content
        # 大列（与 list_ 无 q 分支同思路），避免每次同步全量搬运全部文档正文。
        stmt = (
            select(ScanDocument)
            .where(col(ScanDocument.workspace_id) == workspace_id)
            .options(
                load_only(
                    ScanDocument.id,
                    ScanDocument.workspace_id,
                    ScanDocument.doc_type,
                    ScanDocument.path,
                    ScanDocument.title,
                    ScanDocument.exists,
                    ScanDocument.last_modified_at,
                    ScanDocument.source_member_id,
                    ScanDocument.source_runtime_id,
                    ScanDocument.source_synced_at,
                    ScanDocument.source_mtime,
                    ScanDocument.content_hash,
                )
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())

    @staticmethod
    def _build_row(
        parsed_doc: ParsedDoc,
        *,
        workspace_id: uuid.UUID,
        content_hash: str | None = None,
        source_synced_at: datetime | None = None,
        source_member_id: uuid.UUID | None = None,
        source_runtime_id: uuid.UUID | None = None,
    ) -> ScanDocument:
        return ScanDocument(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            doc_type=parsed_doc.doc_type,
            path=parsed_doc.path,
            title=parsed_doc.title,
            exists=parsed_doc.exists,
            content=parsed_doc.content,
            last_modified_at=parsed_doc.last_modified_at,
            content_hash=content_hash
            or hashlib.sha256((parsed_doc.content or "").encode("utf-8")).hexdigest(),
            source_synced_at=source_synced_at,
            source_member_id=source_member_id,
            source_runtime_id=source_runtime_id,
        )

    @staticmethod
    def _apply_parsed(
        row: ScanDocument,
        parsed_doc: ParsedDoc,
    ) -> None:
        new_hash = hashlib.sha256((parsed_doc.content or "").encode("utf-8")).hexdigest()
        # 内容未变（hash 相同 ⇒ content/title/doc_type 同源不变）时跳过 content
        # 大列重写：reparse 每次页面访问都会执行，未变更行不再产生含正文的
        # UPDATE（perf：数百文档工作区每次进页省掉全部大列写），只同步轻量列。
        if row.content_hash is not None and row.content_hash == new_hash:
            if not _dt_equal(row.last_modified_at, parsed_doc.last_modified_at):
                row.last_modified_at = parsed_doc.last_modified_at
            if not row.exists:
                row.exists = True
            return
        row.doc_type = parsed_doc.doc_type
        row.path = parsed_doc.path
        row.title = parsed_doc.title
        row.exists = parsed_doc.exists
        row.content = parsed_doc.content
        row.last_modified_at = parsed_doc.last_modified_at
        # Preserve/update source tracking columns (task-07)：hash 跟随内容更新
        # （旧实现 hash 只在首次落库，内容变更后永不刷新，skip 判定会永久失效）。
        row.content_hash = new_hash
        if row.source_synced_at is None:
            row.source_synced_at = datetime.now(UTC)
