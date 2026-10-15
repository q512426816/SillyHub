"""平台知识搜索服务（change 2026-10-15-platform-knowledge-search / D-001~D-010）。

消费方：平台用户侧端点 ``POST /api/workspaces/{workspace_id}/knowledge/search``
（router.py，经 ``run_in_threadpool`` 调用本模块 ``search_sync``）。

设计（design.md Phase 1 / decisions D-002@v1~D-007@v1）：

- **语料** = ``spec_root/knowledge/**/*.md`` ∪ ``spec_root/docs/**/*.md``（排任意层级
  ``INDEX.md`` 与 symlink）；不含 changes/ 与 .runtime/（D-002@v1 边界）。
- **切块三档**（D-003@v1）：decisions 按 ``## D-xxx@vN`` 条目 / fr 按 ``## FR-xxx-NNN``
  条目 / 其余 md 按 ``##`` 标题块；单块超 1500 字符按行滑窗细分（窗 ~1000 / 重叠 ~150）。
  frontmatter 段不入正文。每块携带 anchor（条目 id / 标题 slug）供前端定位。
- **索引**：进程内 per-(workspace_key, model_name) 懒构建 + 全语料文件集指纹
  ``(rel_path, mtime_ns, size)`` 失效；与 vector_search.py 的 CLI decisions 索引
  **完全独立**（不同 dict，避免污染 CLI 召回）。构建在锁内（single-flight），顺序 =
  先算指纹 → 构建 → 外回复算指纹不等即重建（防「旧内容 + 新指纹」永久陈旧，D-007@v1）。
- **embedder 单一源**：调用方一律传 ``get_embedder(settings.knowledge_embedding_model)``
  的结果（vector_search.py:137-154 单例；单槽位——不得传其他模型名）。
- **检索**（D-004@v1）：词面（title/path 子串权重高 + 正文次数增益）+ 向量（归一化点积
  余弦，纯 Python 不引 numpy 耦合）融合 ``0.6*vec + 0.4*word``；title/path 词面命中者
  保底 0.9（精确编号/文件名排前的下界；可断言形态 = 相对排序 rank=1）。embedder 不可用
  （fastembed 缺席/模型加载失败）→ ``model_ready=False`` + 纯词面结果 + reason（fail-soft）。
"""

from __future__ import annotations

import asyncio
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Text,
    UniqueConstraint,
    delete,
    or_,
    select,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import Integer, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel
from app.modules.knowledge.parser import slugify_anchor

# ── 持久化 ORM（change 2026-10-15-knowledge-search-pgvector / D-002@v1）──────────
#
# 向量与 chunk 元数据落 PG pgvector（embedding vector(512)），重启零重建；测试引擎为
# SQLite（backend/conftest.py aiosqlite 内存库）——embedding 列经 with_variant 双方言：
# PG = pgvector.sqlalchemy.Vector(512)，SQLite = JSON 文本（查询层方言分叉消费，
# D-004@v1）。ORM 形态先例对齐 hits.py:79 的 KnowledgeHit（模块内定义进同一 metadata）。

_EMBEDDING_DIM = 512  # bge-small-zh-v1.5 维度（settings 默认模型；跨维度换型走显式迁移 R-03）


def _embedding_column() -> Column:
    """embedding 列：PG=vector(512) / SQLite=JSON（with_variant，create_all 双方言可建）。"""
    from pgvector.sqlalchemy import Vector  # 延迟导入：依赖缺席时仅检索持久化面不可用

    return Column(JSON().with_variant(Vector(_EMBEDDING_DIM), "postgresql"), nullable=False)


class KnowledgeSearchChunk(BaseModel, table=True):
    """一个可检索块的持久化行（spec 扫描产物 + 向量）。"""

    __tablename__ = "knowledge_search_chunks"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "spec_path",
            "anchor",
            "title",
            name="uq_kssc_workspace_path_anchor_title",
        ),
        Index("ix_kssc_workspace", "workspace_id"),
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
    spec_path: str = Field(sa_column=Column(String(1024), nullable=False))
    kind: str = Field(sa_column=Column(String(32), nullable=False))
    title: str = Field(sa_column=Column(String(512), nullable=False))
    anchor: str | None = Field(default=None, sa_column=Column(String(256), nullable=True))
    start_line: int = Field(sa_column=Column(Integer, nullable=False))
    text: str = Field(sa_column=Column(Text, nullable=False))
    #: sha256(text)——差量比对键（mtime 指纹漂移被本层吸收：内容未变不重嵌，D-003@v1）。
    content_hash: str = Field(sa_column=Column(String(64), nullable=False))
    #: PG=vector(512) / SQLite=JSON 文本（with_variant；写入侧统一 list[float]，pgvector
    #: 绑定互转由方言驱动；SQLite 存 JSON 供查询层拉回 Python 余弦）。
    embedding: object = Field(default=None, sa_column=_embedding_column())
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class KnowledgeSearchState(BaseModel, table=True):
    """workspace 级同步状态：语料指纹 + 向量模型版本（懒同步判定面，D-003/D-007@v1）。"""

    __tablename__ = "knowledge_search_state"
    __table_args__ = (UniqueConstraint("workspace_id", name="uq_kss_workspace"),)

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
    #: (path, mtime_ns, size) 元组列表序列化（与 corpus_fingerprint() 返回值同源；
    #: 比较前双方 list(map(list, ...)) 归一——JSON 读回为 list，避免 tuple!=list 恒真）。
    corpus_fingerprint: list = Field(sa_column=Column(JSON, nullable=False))
    model_version: str = Field(sa_column=Column(String(128), nullable=False))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


# ── 切块常量（D-003@v1：阈值 1500 / 窗 1000 / 重叠 150——与 design.md Phase 1 同源）──

_CHUNK_MAX = 1500
_SLIDE_WINDOW = 1000
_SLIDE_OVERLAP = 150

#: 条目锚点正则（与本模块独立定义，对齐 vector_search.py:35 的 CLI 契约形态——不复用
#: 该模块避免与其 DecisionEntry（CLI spec_path 契约）耦合）。
_DECISION_HEADING_RE = re.compile(r"^##\s+(D-(?:[A-Za-z0-9_\-\u4e00-\u9fff]+-)?\d+@v\d+)\s+(.*)$")
_FR_HEADING_RE = re.compile(r"^##\s+(FR-[A-Za-z0-9\-]+-\d+)\s+(.*)$")
_H2_RE = re.compile(r"^##\s+(.*)$")
_H1_RE = re.compile(r"^#\s+(.*)$")

#: kind 由 spec_path 派生（design.md Phase 1 表）。
_DOCS_SECTION_KINDS = {"modules": "module", "scan": "scan", "flows": "flow"}


@dataclass(frozen=True, slots=True)
class Chunk:
    """一个可检索块（条目 / 标题块 / 滑窗片段）。"""

    spec_path: str  # 仓根相对 POSIX（"knowledge/..." 或 "docs/..."）
    kind: str  # decision|fr|proposed|generated|knowledge|module|scan|flow|glossary
    title: str  # 条目标题 / 标题块标题 / 文件级回落（H1 或文件名）
    anchor: str | None  # 条目 id（D-xxx@vN / FR-xxx-NNN）或标题 slug；文件级回落为 None
    start_line: int  # 1-based 起始行号（块首行）
    text: str  # embedding 与词面匹配文本（"标题\n正文"）


def kind_for(spec_path: str) -> str:
    """由仓根相对路径派生 kind（design.md Phase 1 表；未知结构按 knowledge/module 兜底）。"""
    p = spec_path.replace("\\", "/")
    if p.startswith("knowledge/decisions/"):
        return "decision"
    if p.startswith("knowledge/fr/"):
        return "fr"
    if p.startswith("knowledge/proposed/"):
        return "proposed"
    if p.startswith("knowledge/generated/"):
        return "generated"
    if p.startswith("knowledge/"):
        return "knowledge"
    if p.startswith("docs/"):
        segs = p.split("/")
        if segs[-1] == "glossary.md":
            return "glossary"
        if len(segs) >= 3 and segs[2] in _DOCS_SECTION_KINDS:
            return _DOCS_SECTION_KINDS[segs[2]]
        return "module"
    return "knowledge"


# ── 切块 ─────────────────────────────────────────────────────────────────────


def _skip_frontmatter(lines: list[str]) -> int:
    """返回正文起始行下标（0-based）；首行 ``---`` 起至闭合 ``---`` 的段跳过。"""
    if lines and lines[0].strip() == "---":
        for idx in range(1, len(lines)):
            if lines[idx].strip() == "---":
                return idx + 1
    return 0


def _fallback_title(lines: list[str], body_start: int, spec_path: str) -> str:
    for line in lines[body_start:]:
        m = _H1_RE.match(line)
        if m:
            return m.group(1).strip()
    return Path(spec_path).stem


def _iter_line_windows(lines: list[str], first_line_no: int) -> list[tuple[int, str]]:
    """按 ~1000 字符切行窗口（相邻窗按行回退 ~150 字符重叠）；单行超窗硬切。

    返回 ``[(1-based 起始行号, 窗口文本)]``。
    """
    n = len(lines)
    out: list[tuple[int, str]] = []
    i = 0
    while i < n:
        start = i
        size = 0
        j = i
        while j < n and (size + len(lines[j]) + 1) <= _SLIDE_WINDOW:
            size += len(lines[j]) + 1
            j += 1
        if j == i:  # 单行超窗：硬切成窗口大小
            out.append((first_line_no + i, lines[i][:_SLIDE_WINDOW]))
            i += 1
            continue
        out.append((first_line_no + start, "\n".join(lines[start:j]).strip()))
        if j >= n:
            break
        back_size = 0
        back = 0
        while back < (j - start) - 1 and back_size < _SLIDE_OVERLAP:
            back += 1
            back_size += len(lines[j - back]) + 1
        i = j - back
    return out


def _emit_segment(
    chunks: list[Chunk],
    spec_path: str,
    kind: str,
    title: str,
    anchor: str | None,
    start_idx: int,
    seg_lines: list[str],
) -> None:
    """把一段（条目/标题块）落为 Chunk；超长按行滑窗细分（``start_line`` 逐窗真实）。"""
    text_all = "\n".join(seg_lines).strip()
    if not text_all:
        return
    head = f"{title}\n" if title else ""
    if len(text_all) <= _CHUNK_MAX:
        chunks.append(Chunk(spec_path, kind, title, anchor, start_idx + 1, head + text_all))
        return
    for line_no, window in _iter_line_windows(seg_lines, start_idx + 1):
        window = window.strip()
        if not window:
            continue
        chunks.append(Chunk(spec_path, kind, title, anchor, line_no, head + window))


def chunk_markdown(spec_path: str, content: str) -> list[Chunk]:
    """把单个 md 文件切为 Chunk 列表（三档规则见模块 docstring）。"""
    kind = kind_for(spec_path)
    lines = content.splitlines()
    body_start = _skip_frontmatter(lines)

    # 主段落定位（title, anchor 或 None, 0-based 行下标）
    sections: list[tuple[str, str | None, int]] = []
    if kind == "decision":
        entry_re: re.Pattern[str] | None = _DECISION_HEADING_RE
    elif kind == "fr":
        entry_re = _FR_HEADING_RE
    else:
        entry_re = None
    for idx in range(body_start, len(lines)):
        m = entry_re.match(lines[idx]) if entry_re is not None else _H2_RE.match(lines[idx])
        if m:
            sections.append(
                (
                    m.group(2).strip() if entry_re is not None else m.group(1).strip(),
                    m.group(1) if entry_re is not None else None,
                    idx,
                )
            )

    chunks: list[Chunk] = []
    if sections:
        for i, (title, anchor, idx) in enumerate(sections):
            end = sections[i + 1][2] if i + 1 < len(sections) else len(lines)
            resolved = anchor if anchor is not None else (slugify_anchor(title) or None)
            _emit_segment(chunks, spec_path, kind, title, resolved, idx, lines[idx:end])
    else:
        title = _fallback_title(lines, body_start, spec_path)
        _emit_segment(chunks, spec_path, kind, title, None, body_start, lines[body_start:])
    return chunks


def scan_corpus(spec_root: Path) -> list[Chunk]:
    """扫描 spec 根 knowledge/ 与 docs/ 下全部 md（排 INDEX.md 与 symlink）。

    文件读失败 fail-soft 跳过（单文件不影响整体语料）。目录缺席 → 空列表。
    """
    chunks: list[Chunk] = []
    for base in ("knowledge", "docs"):
        root_dir = spec_root / base
        if not root_dir.is_dir():
            continue
        for md in sorted(root_dir.rglob("*.md")):
            if md.name == "INDEX.md" or md.is_symlink():
                continue
            try:
                content = md.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            rel = md.relative_to(spec_root).as_posix()
            chunks.extend(chunk_markdown(rel, content))
    return chunks


def corpus_fingerprint(spec_root: Path) -> tuple | None:
    """全语料文件集指纹：``tuple(sorted((rel_path, mtime_ns, size)))``。

    两个语料根都不存在 → ``None``（调用方按空语料处理）。
    """
    parts: list[tuple[str, int, int]] = []
    found = False
    for base in ("knowledge", "docs"):
        root_dir = spec_root / base
        if not root_dir.is_dir():
            continue
        found = True
        for md in root_dir.rglob("*.md"):
            if md.name == "INDEX.md" or md.is_symlink():
                continue
            try:
                st = md.stat()
            except OSError:
                continue
            parts.append((md.relative_to(spec_root).as_posix(), st.st_mtime_ns, st.st_size))
    if not found:
        return None
    return tuple(sorted(parts))


# ── 持久化同步与查询（change 2026-10-15-knowledge-search-pgvector / D-003/D-011）──
#
# 内存索引已被 PG pgvector 两表取代（重启零重建）：查询时懒同步——指纹一致直查库；
# 失配差量（新键插入 / hash 变重嵌 / 消失删除 / mtime 漂移被 hash 层吸收）；
# model_version 变更全量重算。进程内 asyncio.Lock（键 = workspace_key）single-flight
# 挡同进程并发首查；跨进程由 DB uq + ON CONFLICT/REPLACE 幂等兜底（R-04）。
# DB 异常 → 词面内存直查降级（scan_corpus + _word_score，搜索永不 5xx，design 降级链）。

_sync_locks: dict[str, asyncio.Lock] = {}
_sync_locks_guard = threading.Lock()  # 双检创建锁的守卫（asyncio.Lock 创建本身线程安全）

_DB_DEGRADED_PREFIX = "knowledge_search_db_degraded: "

_LEGACY_INDEXES: dict[tuple[str, str], dict] = {}  # 兼容留位（旧内存路径已由 DB 取代）


def _get_sync_lock(workspace_key: str) -> asyncio.Lock:
    """per-workspace asyncio.Lock（async 协程跨 await 持有安全——Grill 增量复审残留①）。"""
    with _sync_locks_guard:
        lock = _sync_locks.get(workspace_key)
        if lock is None:
            lock = asyncio.Lock()
            _sync_locks[workspace_key] = lock
        return lock


def _content_hash(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _norm_fingerprint(fp: tuple | list | None) -> list | None:
    """指纹归一化：tuple[tuple,...] / JSON list[list] 统一为 list[list]（Grill 修订——
    否则 tuple != list 恒真、快路径恒失效，每次查询多付全语料读取）。"""
    if fp is None:
        return None
    return [list(item) for item in fp]


async def _db_session(session_factory):
    """短会话上下文（async with）；factory 缺省取全局（测试面经 conftest 重定向）。"""
    if session_factory is None:
        from app.core.db import get_session_factory

        session_factory = get_session_factory()
    return session_factory()


async def _ensure_synced(
    session: AsyncSession,
    spec_root: Path,
    workspace_id: uuid.UUID,
    workspace_key: str,
    fp_now: tuple | None,
    model_name: str,
    embedder: object | None,
) -> None:
    """懒同步主体（调用方持 per-workspace 锁；DB 异常向上抛给降级链）。

    三分支：state 缺失或 model_version 不符 → 全量；指纹失配（归一化后比较）→ 差量；
    一致 → 直查。embedder None 时仍可同步（写入零向量占位——词面路可查；向量路本就禁用，模型恢复且语料未变时零向量滞留至下次变更重嵌，D-007@v1 的实现口径）。
    """
    state = (
        await session.execute(
            select(KnowledgeSearchState).where(KnowledgeSearchState.workspace_id == workspace_id)
        )
    ).scalar_one_or_none()
    fp_norm = _norm_fingerprint(fp_now)
    if (
        state is not None
        and state.model_version == model_name
        and _norm_fingerprint(state.corpus_fingerprint) == fp_norm
    ):
        return  # 快路径：指纹一致零嵌入调用
    if state is None or state.model_version != model_name:
        await _sync_full(session, spec_root, workspace_id, fp_now, model_name, embedder)
    else:
        await _sync_delta(session, spec_root, workspace_id, fp_now, model_name, embedder)
    if state is None:
        state = KnowledgeSearchState(
            workspace_id=workspace_id,
            corpus_fingerprint=fp_norm or [],
            model_version=model_name,
        )
        session.add(state)
    else:
        state.corpus_fingerprint = fp_norm or []
        state.model_version = model_name
    await session.commit()


async def _rows_by_key(
    session: AsyncSession, workspace_id: uuid.UUID
) -> dict[tuple[str, str | None, str], KnowledgeSearchChunk]:
    """库行键集 {(spec_path, anchor, title): row}（差量比对基线，一次 SELECT）。"""
    rows = (
        (
            await session.execute(
                select(KnowledgeSearchChunk).where(
                    KnowledgeSearchChunk.workspace_id == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    return {(r.spec_path, r.anchor, r.title): r for r in rows}


def _chunk_row(workspace_id: uuid.UUID, c: Chunk, embedding: list[float]) -> KnowledgeSearchChunk:
    return KnowledgeSearchChunk(
        workspace_id=workspace_id,
        spec_path=c.spec_path,
        kind=c.kind,
        title=c.title,
        anchor=c.anchor,
        start_line=c.start_line,
        text=c.text,
        content_hash=_content_hash(c.text),
        embedding=embedding,
    )


async def _sync_full(
    session: AsyncSession,
    spec_root: Path,
    workspace_id: uuid.UUID,
    fp_now: tuple | None,
    model_name: str,
    embedder: object | None,
) -> None:
    """全量重算：清 chunks → 逐 chunk 嵌入批量插入（嵌入批量经 to_thread 卸载）。"""
    await session.execute(
        delete(KnowledgeSearchChunk).where(KnowledgeSearchChunk.workspace_id == workspace_id)
    )
    chunks = await asyncio.to_thread(scan_corpus, spec_root)
    if not chunks:
        return
    if embedder is None:
        # 词面降级态也要可查：仅存元数据（embedding 置零向量，向量路本就禁用）
        vectors: list[list[float]] = [[0.0] * _EMBEDDING_DIM for _ in chunks]
    else:
        vectors = await asyncio.to_thread(embedder.embed, [c.text for c in chunks])
    session.add_all([_chunk_row(workspace_id, c, vectors[i]) for i, c in enumerate(chunks)])
    await session.commit()


async def _sync_delta(
    session: AsyncSession,
    spec_root: Path,
    workspace_id: uuid.UUID,
    fp_now: tuple | None,
    model_name: str,
    embedder: object | None,
) -> None:
    """差量四态：新键 INSERT（嵌入）/ hash 变 UPDATE 重嵌 / 消失 DELETE / 同跳过。"""
    existing = await _rows_by_key(session, workspace_id)
    chunks = await asyncio.to_thread(scan_corpus, spec_root)
    fresh_keys = set()
    to_embed: list[tuple[KnowledgeSearchChunk | None, Chunk]] = []  # (库行|None, 新 chunk)
    for c in chunks:
        key = (c.spec_path, c.anchor, c.title)
        fresh_keys.add(key)
        h = _content_hash(c.text)
        row = existing.get(key)
        if row is None or row.content_hash != h:
            to_embed.append((row, c))
    # 嵌入批量一次（to_thread 卸载；embedder None 时词面降级写零向量占位）
    if to_embed:
        if embedder is None:
            vecs: list[list[float]] = [[0.0] * _EMBEDDING_DIM for _ in to_embed]
        else:
            vecs = await asyncio.to_thread(embedder.embed, [c.text for _, c in to_embed])
        for (row, c), vec in zip(to_embed, vecs, strict=True):
            if row is None:
                session.add(_chunk_row(workspace_id, c, vec))
            else:
                row.text = c.text
                row.start_line = c.start_line
                row.kind = c.kind
                row.content_hash = _content_hash(c.text)
                row.embedding = vec
    for key in existing.keys() - fresh_keys:
        await session.delete(existing[key])
    await session.commit()


async def _query_vector_candidates(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    q_vec: list[float],
    k: int,
) -> list[tuple[KnowledgeSearchChunk, float]]:
    """向量路 top-k 候选：PG = pgvector KNN（<=> 余弦距离）；SQLite = 拉回 Python 余弦。"""
    dialect = session.bind.dialect.name if session.bind is not None else "sqlite"
    if dialect == "postgresql":
        rows = (
            await session.execute(
                select(KnowledgeSearchChunk, KnowledgeSearchChunk.embedding.cosine_distance(q_vec))
                .where(KnowledgeSearchChunk.workspace_id == workspace_id)
                .order_by(KnowledgeSearchChunk.embedding.cosine_distance(q_vec))
                .limit(k)
            )
        ).all()
        return [(chunk, 1.0 - float(dist)) for chunk, dist in rows]
    # SQLite（测试）：拉回全量 embedding JSON → Python 余弦（D-004@v1 方言分叉）
    rows = (
        (
            await session.execute(
                select(KnowledgeSearchChunk).where(
                    KnowledgeSearchChunk.workspace_id == workspace_id
                )
            )
        )
        .scalars()
        .all()
    )
    chunks: list[KnowledgeSearchChunk] = list(rows)
    scored: list[tuple[KnowledgeSearchChunk, float]] = [
        (row, _cosine(q_vec, list(row.embedding or []))) for row in chunks
    ]
    scored.sort(key=lambda pair: -pair[1])
    return scored[:k]


async def _query_word_candidates(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    q: str,
    cap: int = 500,
) -> list[KnowledgeSearchChunk]:
    """词面路候选：SQL ILIKE（escape 口径对齐 scan_docs/service.py:158-169）+ LIMIT 上限。"""
    escaped = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    pat = f"%{escaped}%"
    rows = (
        (
            await session.execute(
                select(KnowledgeSearchChunk)
                .where(KnowledgeSearchChunk.workspace_id == workspace_id)
                .where(
                    or_(
                        KnowledgeSearchChunk.title.ilike(pat, escape="\\"),
                        KnowledgeSearchChunk.spec_path.ilike(pat, escape="\\"),
                        KnowledgeSearchChunk.text.ilike(pat, escape="\\"),
                    )
                )
                .limit(cap)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


def reset_index_for_tests() -> None:
    """测试隔离：清空进程内同步锁（生产勿调）。"""
    with _sync_locks_guard:
        _sync_locks.clear()


# ── 打分与片段 ───────────────────────────────────────────────────────────────


def _cosine(a: list[float], b: list[float]) -> float:
    """归一化点积（余弦）；零向量返回 0（口径对齐 vector_search.py:179-197 纯 Python 实现）。"""
    na = sum(x * x for x in a) ** 0.5
    nb = sum(x * x for x in b) ** 0.5
    if na <= 0 or nb <= 0:
        return 0.0
    return sum(x * y for x, y in zip(a, b, strict=False)) / (na * nb)


def _word_score(query_lower: str, chunk: Chunk) -> tuple[float, bool]:
    """词面路打分：标题面（anchor/title）0.6 / path 0.25 / 正文按次数 ≤0.15。

    返回 ``(归一化分, 精确命中)``；``精确命中`` = 标题面或 path 词面命中（保底 0.9 的
    适用面）。**标题面含 anchor**（决策/FR 条目编号在 anchor 字段而非 title 文本——
    查 D-xxx@vN / FR-xxx-NNN 的精确命中必须由 anchor 承载，执行期裁决 D-011@v1）。
    """
    anchor_hit = bool(chunk.anchor) and query_lower in (chunk.anchor or "").lower()
    title_hit = bool(chunk.title) and query_lower in chunk.title.lower()
    path_hit = query_lower in chunk.spec_path.lower()
    score = 0.0
    if anchor_hit or title_hit:
        score += 0.6
    if path_hit:
        score += 0.25
    hits = chunk.text.lower().count(query_lower)
    if hits:
        score += min(0.15, 0.05 * hits)
    return min(score, 1.0), (anchor_hit or title_hit or path_hit)


def _make_snippet(text: str, query: str) -> str:
    """匹配上下文片段：词面命中取 ±120 字符窗口；纯语义命中取头部 240 字符。

    换行折为空格（前端两行展示友好）；截断处补省略号。
    """
    if query:
        idx = text.lower().find(query.lower())
        if idx >= 0:
            lo = max(0, idx - 120)
            hi = min(len(text), idx + len(query) + 120)
            core = text[lo:hi].replace("\n", " ").strip()
            prefix = "…" if lo > 0 else ""
            suffix = "…" if hi < len(text) else ""
            return f"{prefix}{core}{suffix}"
    core = text[:240].replace("\n", " ").strip()
    return core + "…" if len(text) > 240 else core


# ── 检索主体（async 编排：DB await 原生执行 + CPU/IO 经 to_thread 卸载；D-005@v2）──


async def search_sync(
    spec_root: Path,
    workspace_key: str,
    query: str,
    limit: int,
    embedder: object | None,
    model_name: str,
    *,
    embedder_error: str | None = None,
    session_factory: object | None = None,
) -> dict:
    """检索：返回 ``{results, model_ready, reason}``（形态与上变更内存版逐字段一致）。

    ``results`` 项 = ``{spec_path, kind, title, anchor, snippet, score}``（融合分降序；
    去重取最高分）。embedder None → 纯词面 + ``model_ready=False``；DB 异常 →
    词面内存直查降级（reason 带 ``knowledge_search_db_degraded:`` 前缀，搜索永不 5xx）。
    """
    q = str(query or "").strip()
    model_ready = embedder is not None
    reason = None if model_ready else (embedder_error or "embedder unavailable")
    if not q:
        return {"results": [], "model_ready": model_ready, "reason": reason}
    fp_now = await asyncio.to_thread(corpus_fingerprint, spec_root)
    if fp_now is None:
        return {"results": [], "model_ready": model_ready, "reason": reason}
    try:
        ws_id = uuid.UUID(workspace_key)
    except (ValueError, AttributeError):
        return {"results": [], "model_ready": model_ready, "reason": reason}

    try:
        async with await _db_session(session_factory) as session:
            lock = _get_sync_lock(workspace_key)
            async with lock:
                await _ensure_synced(
                    session, spec_root, ws_id, workspace_key, fp_now, model_name, embedder
                )
            # 查询双路（同步完成后读——不读半态）
            q_vec = None
            if embedder is not None:
                q_vec = (await asyncio.to_thread(embedder.embed, [q]))[0]
            vec_rows: list[tuple[KnowledgeSearchChunk, float]] = []
            if q_vec is not None:
                vec_rows = await _query_vector_candidates(session, ws_id, q_vec, limit * 3)
            word_rows = await _query_word_candidates(session, ws_id, q)
    except Exception as exc:  # DB 异常 → 词面内存直查降级（fail-soft，搜索永不 5xx）
        return await _fallback_word_scan(
            spec_root, q, limit, model_ready, f"{_DB_DEGRADED_PREFIX}{type(exc).__name__}: {exc}"
        )

    # Python 侧融合打分（口径不变：0.6*vec + 0.4*word + 保底 0.9 + 零信号过滤 + 去重）
    q_lower = q.lower()
    best: dict[tuple[str, str | None, str], tuple[float, KnowledgeSearchChunk]] = {}
    vec_score_by_id = {row.id: sim for row, sim in vec_rows}
    for row in word_rows + [r for r, _ in vec_rows]:
        word, exact = _word_score_row(q_lower, row)
        sim = vec_score_by_id.get(row.id)
        if sim is not None:
            score = 0.6 * sim + 0.4 * word
            if exact:
                score = max(score, 0.9)
        else:
            score = word
        dedup_key = (row.spec_path, row.anchor, row.title)
        cur = best.get(dedup_key)
        if cur is None or score > cur[0]:
            best[dedup_key] = (score, row)

    # 零信号块过滤：融合分 0 不返回（「搜不到」空态可达；design R-03 只砍零信号）
    ranked = sorted(
        (pair for pair in best.values() if pair[0] > 0),
        key=lambda pair: (-pair[0], pair[1].spec_path, pair[1].start_line),
    )
    results = [
        {
            "spec_path": c.spec_path,
            "kind": c.kind,
            "title": c.title,
            "anchor": c.anchor,
            "snippet": _make_snippet(c.text, q),
            "score": round(score, 6),
        }
        for score, c in ranked[: max(1, int(limit))]
    ]
    return {"results": results, "model_ready": model_ready, "reason": reason}


def _word_score_row(query_lower: str, row: KnowledgeSearchChunk) -> tuple[float, bool]:
    """词面打分（库行版；口径与 _word_score 逐字段一致——title/anchor 0.6、path 0.25、
    正文次数 ≤0.15，anchor∨title∨path 命中 = 精确命中）。"""
    anchor_hit = bool(row.anchor) and query_lower in (row.anchor or "").lower()
    title_hit = bool(row.title) and query_lower in row.title.lower()
    path_hit = query_lower in row.spec_path.lower()
    score = 0.0
    if anchor_hit or title_hit:
        score += 0.6
    if path_hit:
        score += 0.25
    hits = row.text.lower().count(query_lower)
    if hits:
        score += min(0.15, 0.05 * hits)
    return min(score, 1.0), (anchor_hit or title_hit or path_hit)


async def _fallback_word_scan(
    spec_root: Path, q: str, limit: int, model_ready: bool, reason: str
) -> dict:
    """DB 异常降级：scan_corpus + _word_score 内存直查（上变更内存实现的无向量版）。"""
    chunks = await asyncio.to_thread(scan_corpus, spec_root)
    q_lower = q.lower()
    best: dict[tuple[str, str | None, str], tuple[float, Chunk]] = {}
    for chunk in chunks:
        word, _exact = _word_score(q_lower, chunk)
        dedup_key = (chunk.spec_path, chunk.anchor, chunk.title)
        cur = best.get(dedup_key)
        if cur is None or word > cur[0]:
            best[dedup_key] = (word, chunk)
    ranked = sorted(
        (pair for pair in best.values() if pair[0] > 0),
        key=lambda pair: (-pair[0], pair[1].spec_path, pair[1].start_line),
    )
    results = [
        {
            "spec_path": c.spec_path,
            "kind": c.kind,
            "title": c.title,
            "anchor": c.anchor,
            "snippet": _make_snippet(c.text, q),
            "score": round(word, 6),
        }
        for word, c in ranked[: max(1, int(limit))]
    ]
    return {"results": results, "model_ready": model_ready, "reason": reason}
