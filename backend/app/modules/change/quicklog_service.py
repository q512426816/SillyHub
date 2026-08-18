"""QUICKLOG 查询服务：双源合并 + stale 派生 + enrich + 模块推导（FR-04/FR-08 / D-005）。

数据 = PG 推送条目（``quicklog_entries`` payload，CLI 直写时点新）∪ 文件解析条目
（``spec_root/quicklog/`` 镜像，daemon 同步滞后副本），按 ``ql_id`` 去重**PG 优先**
（D-003：CLI ``--done`` 翻状态后推送先于 daemon 文件同步到达）。

派生字段查询时计算、不落库（D-005）：
- ``stale``：in_progress 且 now-timestamp>24h（阈值可注入；时钟偏差误报可接受 R-03）。
- ``author_name``：批量 IN 查 users（display_name 优先 username fallback，查不到回退
  author_raw；失败不抛，R-03 禁 N+1 对齐 ``_resolve_user_names``）。
- ``owner_name``：关联变更 owner 优先（ql-20260818-006，对齐变更列表 owner 来源）——
  linked_changes → changes.owner_id → users 按 ID 解析 display_name 优先；与进行中/
  已归档列表同源同口径（token 上行的权威身份链）。无关联变更 / 关联行无 owner /
  用户已删时回退既有 author 链（author_name/author_raw，前端兜底展示）。
- ``affected_modules``：文件路径集合 → change/parser.py module-map 前缀匹配口径
  （spec docs 现状覆盖度低时输出空列表，前端展示「—」，R-06）。

只读不写（NG-06：平台侧主动写回 QUICKLOG 文件会撞 daemon 增量同步乐观锁）。
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.change.parser import ChangeParser
from app.modules.change.quicklog_parser import (
    QuicklogFileEntry,
    parse_quicklog_directory,
)
from app.modules.platform_sync.model import QuicklogEntryORM

STALE_THRESHOLD = timedelta(hours=24)


@dataclass(frozen=True)
class QuicklogMergedEntry:
    """合并后的条目（文件/PG 同构 + 派生字段 + 来源标记，design §5.1 DTO）。"""

    ql_id: str
    timestamp: datetime | None
    title: str
    status: str  # completed | in_progress | partial_done | stale（派生后 4 态）
    status_note: str | None
    placeholder: bool
    author_raw: str
    author_name: str | None = None  # enrich 派生
    owner_name: str | None = None  # 关联变更 owner 派生（ql-20260818-006 优先展示）
    linked_changes: tuple[str, ...] = ()
    files: tuple[tuple[str, str | None], ...] = ()  # (path, note)
    body_sections: dict[str, str] | None = None  # 详情用；列表可不带
    raw_block: str | None = None
    source: str = "file"  # pushed | file
    truncated: bool = False


async def _spec_content_root(session: AsyncSession, workspace: Any) -> Path:
    """解析 `.sillyspec` 内容根（对齐 knowledge service 口径，design §5.2）。"""
    try:
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws = await SpecWorkspaceService(session).get(workspace.id)
        if spec_ws and spec_ws.spec_root:
            return Path(spec_ws.spec_root)
    except Exception:
        pass
    return Path(workspace.root_path) / ".sillyspec"


def _norm_utc(ts: datetime | None) -> datetime | None:
    """naive → 视为 UTC（CLI 落盘时间串无时区；stale 相减需 aware 对齐）。"""
    if ts is not None and ts.tzinfo is None:
        return ts.replace(tzinfo=UTC)
    return ts


def _to_wallclock(ts: datetime | None) -> datetime | None:
    """输出边界剥时区（ql-20260818-007）：下发 naive 墙钟。

    CLI 落盘/推送的时间串是**本地墙钟**（无时区），``_norm_utc`` 打上的 UTC 标签
    只服务于 stale 内部 aware 运算。若带 Z 下发，前端 ``toLocaleString`` 会再按
    浏览器本地时区换算——中国用户看到 +8h 双重偏移。剥掉标签后 JS ``new Date``
    按**本地**解析 naive 串，展示与 CLI 落盘墙钟一致（个人平台：查看者与 CLI
    同时区是常态；跨时区查看者按自己墙钟理解，可接受）。
    """
    return ts.replace(tzinfo=None) if ts is not None else None


def _from_pushed_payload(payload: dict[str, Any]) -> QuicklogMergedEntry:
    """PG payload → 合并条目（CLI 推送字段对齐 QuicklogEntryPushRequest）。"""
    ts: datetime | None = None
    ts_raw = payload.get("timestamp")
    if isinstance(ts_raw, str) and ts_raw:
        for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
            try:
                ts = datetime.strptime(ts_raw, fmt)
                break
            except ValueError:
                continue
    ts = _norm_utc(ts)
    files_raw = payload.get("files") or []
    files: list[tuple[str, str | None]] = []
    if isinstance(files_raw, list):
        for f in files_raw:
            if isinstance(f, dict) and f.get("path"):
                files.append((str(f["path"]), f.get("note")))
            elif isinstance(f, str):
                files.append((f, None))
    body = payload.get("body_sections")
    title = str(payload.get("title") or "")
    return QuicklogMergedEntry(
        ql_id=str(payload.get("ql_id", "")),
        timestamp=ts,
        title=title,
        status=str(payload.get("status") or "in_progress"),
        status_note=payload.get("status_note"),
        placeholder=title == "(quick 任务)",
        author_raw=str(payload.get("author_raw") or ""),
        linked_changes=tuple(payload.get("linked_changes") or ()),
        files=tuple(files),
        body_sections=body if isinstance(body, dict) else {},
        raw_block=payload.get("raw_block"),
        source="pushed",
    )


def _from_file_entry(e: QuicklogFileEntry) -> QuicklogMergedEntry:
    return QuicklogMergedEntry(
        ql_id=e.ql_id,
        timestamp=_norm_utc(e.timestamp),
        title=e.title,
        status=e.status,
        status_note=e.status_note,
        placeholder=e.placeholder,
        author_raw=e.author_raw,
        linked_changes=tuple(e.linked_changes),
        files=tuple((f.path, f.note) for f in e.files),
        body_sections=dict(e.body_sections),
        raw_block=e.raw_block,
        source="file",
        truncated=e.truncated,
    )


def derive_stale(
    entries: list[QuicklogMergedEntry], now: datetime, threshold: timedelta = STALE_THRESHOLD
) -> list[QuicklogMergedEntry]:
    """in_progress 且 now-timestamp>阈值 → stale（D-005 查询时派生；时间缺失不派生）。"""
    result: list[QuicklogMergedEntry] = []
    for e in entries:
        if e.status == "in_progress" and e.timestamp is not None and now - e.timestamp > threshold:
            e = QuicklogMergedEntry(**{**e.__dict__, "status": "stale"})
        result.append(e)
    return result


async def _enrich_authors(
    session: AsyncSession, entries: list[QuicklogMergedEntry]
) -> list[QuicklogMergedEntry]:
    """author_raw → users.username 命中 → display_name 优先 username fallback。

    查不到 / 无用户表命中回退 author_raw（前端展示回退名）；一次 IN 查询禁 N+1
    （对齐 change service ``_resolve_user_names`` 口径）。任何异常吞掉回退原始名
    （enrich 失败不抛，task-04 constraints）。
    """
    names = {e.author_raw for e in entries if e.author_raw}
    mapping: dict[str, str] = {}
    if names:
        try:
            stmt = select(User.username, User.display_name).where(col(User.username).in_(names))
            rows = (await session.execute(stmt)).all()
            for username, display_name in rows:
                mapping[username] = display_name or username or ""
        except Exception:
            mapping = {}
    return [
        QuicklogMergedEntry(
            **{**e.__dict__, "author_name": mapping.get(e.author_raw) or e.author_raw}
        )
        for e in entries
    ]


async def _enrich_linked_change_owners(
    session: AsyncSession, workspace: Any, entries: list[QuicklogMergedEntry]
) -> list[QuicklogMergedEntry]:
    """linked_changes → changes.owner_id → users 按 ID 解析（ql-20260818-006）。

    负责人来源对齐变更列表（进行中/已归档）口径：owner_id 是 token 上行的权威
    身份，users 解析 display_name 优先 username fallback（同 change service
    ``_resolve_user_names``）。条目按 linked_changes 顺序取第一个能解析出名字的
    owner；无关联 / 关联行无 owner / 用户已删 → owner_name 保持 None（前端回退
    既有 author 链兜底）。两次 IN 查询禁 N+1；任何异常吞掉不 enrich（对齐
    ``_enrich_authors`` fail-soft）。
    """
    keys = {k for e in entries for k in e.linked_changes}
    if not keys:
        return entries
    key_to_owner: dict[str, Any] = {}
    names_by_id: dict[Any, str] = {}
    try:
        rows = (
            await session.execute(
                select(Change.change_key, Change.owner_id).where(
                    col(Change.workspace_id) == workspace.id,
                    col(Change.change_key).in_(keys),
                )
            )
        ).all()
        key_to_owner = {key: owner for key, owner in rows if owner is not None}
        owner_ids = set(key_to_owner.values())
        if owner_ids:
            user_rows = (
                await session.execute(
                    select(User.id, User.display_name, User.username).where(
                        col(User.id).in_(owner_ids)
                    )
                )
            ).all()
            names_by_id = {
                uid: display_name or username or "" for uid, display_name, username in user_rows
            }
    except Exception:
        return entries

    def _owner_of(e: QuicklogMergedEntry) -> str | None:
        for key in e.linked_changes:
            owner = key_to_owner.get(key)
            if owner is not None:
                name = names_by_id.get(owner)
                if name:
                    return name
        return None

    return [QuicklogMergedEntry(**{**e.__dict__, "owner_name": _owner_of(e)}) for e in entries]


@dataclass(frozen=True)
class QuicklogQueryResult:
    """list_entries 输出：条目（含派生字段）+ 总数（分页前）。"""

    items: list[QuicklogMergedEntry]
    total: int
    modules_by_ql: dict[str, list[str]]


class QuicklogQueryService:
    """QUICKLOG 查询（只读合并；session 请求内注入，对齐 service 惯例）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def merge_entries(
        self, workspace: Any, include_body: bool = True
    ) -> list[QuicklogMergedEntry]:
        """双源合并：PG ∪ 文件，ql_id 去重 PG 优先（D-003），timestamp desc 排序。"""
        pushed_rows = (
            (
                await self._session.execute(
                    select(QuicklogEntryORM).where(
                        col(QuicklogEntryORM.workspace_id) == workspace.id
                    )
                )
            )
            .scalars()
            .all()
        )
        pushed = [_from_pushed_payload(row.payload or {"ql_id": row.ql_id}) for row in pushed_rows]

        root = await _spec_content_root(self._session, workspace)
        parsed = parse_quicklog_directory(root / "quicklog")

        merged: dict[str, QuicklogMergedEntry] = {}
        for e in parsed:
            entry = _from_file_entry(e)
            if not include_body:
                entry = QuicklogMergedEntry(
                    **{**entry.__dict__, "body_sections": None, "raw_block": None}
                )
            merged[entry.ql_id] = entry
        for e in pushed:  # PG 后写覆盖同 ql_id（推送时点新）
            if not include_body:
                e = QuicklogMergedEntry(**{**e.__dict__, "body_sections": None, "raw_block": None})
            merged[e.ql_id] = e

        def _sort_key(e: QuicklogMergedEntry) -> tuple:
            return (e.timestamp is not None, e.timestamp or datetime.min.replace(tzinfo=UTC))

        return sorted(merged.values(), key=_sort_key, reverse=True)

    async def list_entries(
        self,
        workspace: Any,
        *,
        search: str | None = None,
        status: str | None = None,
        author: str | None = None,
        linked_change: str | None = None,
        include_placeholder: bool = False,
        now: datetime | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> QuicklogQueryResult:
        """列表：合并 → stale 派生 → enrich → 模块推导 → 筛选（search 需正文）→ 分页。

        合并保留正文（search 匹配标题+四段全文，FR-04），筛选完成后输出前剥离
        body/raw_block（列表轻量，详情走 get_entry）。
        """
        entries = await self.merge_entries(workspace, include_body=True)
        now = now or datetime.now(UTC)
        entries = derive_stale(entries, now)
        entries = await _enrich_authors(self._session, entries)
        entries = await _enrich_linked_change_owners(self._session, workspace, entries)

        sillyspec_root = await _spec_content_root(self._session, workspace)
        modules_by_ql = self._modules_by_ql(entries, sillyspec_root)

        # 筛选（author 匹配含 owner_name——与前端展示口径一致，ql-20260818-006）
        filtered: list[QuicklogMergedEntry] = []
        needle = (search or "").strip().lower()
        for e in entries:
            if not include_placeholder and e.placeholder:
                continue
            if status and e.status != status:
                continue
            if author and author not in (
                e.owner_name,
                e.author_raw,
                e.author_name or "",
            ):
                continue
            if linked_change and linked_change not in e.linked_changes:
                continue
            if needle:
                haystack = " ".join(
                    [e.title, *(e.body_sections or {}).values(), e.author_raw or ""]
                ).lower()
                if needle not in haystack:
                    continue
            filtered.append(e)

        total = len(filtered)
        start = (page - 1) * page_size
        # 输出边界剥时区（ql-20260818-007）：timestamp 下发 naive 墙钟防 +8h 双重偏移
        page_items = [
            QuicklogMergedEntry(
                **{
                    **e.__dict__,
                    "timestamp": _to_wallclock(e.timestamp),
                    "body_sections": None,
                    "raw_block": None,
                }
            )
            for e in filtered[start : start + page_size]
        ]
        return QuicklogQueryResult(items=page_items, total=total, modules_by_ql=modules_by_ql)

    async def get_entry(
        self, workspace: Any, ql_id: str, now: datetime | None = None
    ) -> QuicklogMergedEntry | None:
        """详情：单条全字段（含 body 全文 + raw_block；placeholder 不过滤——详情可看）。"""
        entries = await self.merge_entries(workspace, include_body=True)
        now = now or datetime.now(UTC)
        entries = derive_stale(entries, now)
        entries = await _enrich_authors(self._session, entries)
        entries = await _enrich_linked_change_owners(self._session, workspace, entries)
        for e in entries:
            if e.ql_id == ql_id:
                # 同 list_entries：详情输出也剥时区（ql-20260818-007）
                return QuicklogMergedEntry(
                    **{**e.__dict__, "timestamp": _to_wallclock(e.timestamp)}
                )
        return None

    @staticmethod
    def _modules_by_ql(
        entries: list[QuicklogMergedEntry], sillyspec_root: Path
    ) -> dict[str, list[str]]:
        """每条目的文件路径 → module-map 推导（复用 ChangeParser 口径，R-06）。"""
        try:
            module_map = ChangeParser._load_module_map(sillyspec_root)
        except Exception:
            module_map = {}
        if not module_map:
            return {}
        result: dict[str, list[str]] = {}
        for e in entries:
            paths = {p for p, _ in e.files if p}
            if paths:
                mods = ChangeParser._match_paths_to_modules(paths, module_map)
                if mods:
                    result[e.ql_id] = mods
        return result
