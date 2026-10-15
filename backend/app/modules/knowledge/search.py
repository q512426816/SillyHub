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

import re
import threading
from dataclasses import dataclass
from pathlib import Path

from app.modules.knowledge.parser import slugify_anchor

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


# ── 索引（懒构建 + 指纹失效；与 vector_search.py 的 CLI 索引完全独立）──────────

_index_lock = threading.Lock()
_indexes: dict[tuple[str, str], dict] = {}  # (workspace_key, model_name) → 缓存条目


def _build_index_locked(spec_root: Path, key: tuple[str, str], embedder: object | None) -> dict:
    """锁内构建索引（调用方持 ``_index_lock``）。

    指纹在 scan **之前**计算并作为存储值——构建期间的文件变更会让外回复算不等，
    触发重建（防陈旧索引自愈的保守方向）。
    """
    fp = corpus_fingerprint(spec_root)
    chunks = scan_corpus(spec_root)
    vectors = embedder.embed([c.text for c in chunks]) if (embedder is not None and chunks) else []
    entry = {"fingerprint": fp, "chunks": chunks, "vectors": vectors}
    _indexes[key] = entry
    return entry


def reset_index_for_tests() -> None:
    """测试隔离：清空索引缓存（生产勿调）。"""
    with _index_lock:
        _indexes.clear()


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


# ── 检索主体（路由侧经 run_in_threadpool 调用；embedder 参数供测试注入 fake）────


def search_sync(
    spec_root: Path,
    workspace_key: str,
    query: str,
    limit: int,
    embedder: object | None,
    model_name: str,
    *,
    embedder_error: str | None = None,
) -> dict:
    """同步检索：返回 ``{results, model_ready, reason}``。

    ``results`` 项 = ``{spec_path, kind, title, anchor, snippet, score}``（按融合分降序；
    同文件同 anchor 去重取最高分）。embedder None（不可用）→ 纯词面结果 + ``model_ready=False``。
    """
    q = str(query or "").strip()
    model_ready = embedder is not None
    reason = None if model_ready else (embedder_error or "embedder unavailable")
    if not q:
        return {"results": [], "model_ready": model_ready, "reason": reason}
    if corpus_fingerprint(spec_root) is None:
        return {"results": [], "model_ready": model_ready, "reason": reason}

    key = (workspace_key, model_name)
    with _index_lock:
        fp = corpus_fingerprint(spec_root)
        cached = _indexes.get(key)
        if cached is None or cached["fingerprint"] != fp:
            cached = _build_index_locked(spec_root, key, embedder)
            # 构建后复算：构建期间文件变更 → 立即重建（最多 2 轮，防持续写入死循环）
            for _ in range(2):
                if corpus_fingerprint(spec_root) == cached["fingerprint"]:
                    break
                cached = _build_index_locked(spec_root, key, embedder)
        chunks: list[Chunk] = cached["chunks"]
        vectors: list[list[float]] = cached["vectors"]

    q_vec = embedder.embed([q])[0] if embedder is not None else None
    q_lower = q.lower()
    best: dict[tuple[str, str | None, str], tuple[float, Chunk]] = {}
    for i, chunk in enumerate(chunks):
        word, exact = _word_score(q_lower, chunk)
        if q_vec is not None and i < len(vectors):
            score = 0.6 * _cosine(q_vec, vectors[i]) + 0.4 * word
            if exact:
                score = max(score, 0.9)
        else:
            score = word
        dedup_key = (chunk.spec_path, chunk.anchor, chunk.title)
        cur = best.get(dedup_key)
        if cur is None or score > cur[0]:
            best[dedup_key] = (score, chunk)

    # 零信号块过滤：融合分为 0（既无词面命中、向量零相似）不返回——「搜不到」空态
    # 可达。更严的相关性阈值需真实语料标定（见 design R-03），本期只砍零信号。
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
