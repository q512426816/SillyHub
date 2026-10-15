"""平台向量检索服务（change 2026-10-15-platform-vector-search）。

CLI 契约（sillyspec 仓 src/knowledge-vector.js 文件头 = 实现规格，测试夹具即对拍样例）：
``POST /api/spec/knowledge/vector-search``，Bearer ``shpsync_`` workspace token，
Body ``{query, limit}`` → ``200 {ok, results:[{spec_path, anchor, change, score}]}``。

设计（拍板 2026-10-15 本地小模型方案）：

- **embedding = fastembed 本地 ONNX 小模型**（默认 ``bge-small-zh-v1.5``，镜像内
  ~90MB，零 key 零 API 零持续成本，中文短文本主场）。``Settings.knowledge_embedding_model``
  可配。fastembed 缺席/模型初始化失败 → embedder 不可用态（fail-soft：端点返回
  ``{ok, results:[], model_ready: false, reason}``，CLI 静默降级本地词面层——
  与 404 时代的降级契约同语义）。lazy import 不阻塞应用启动；模型文件首次使用时
  下载（生产 Docker 可预烤进镜像）。
- **语料** = workspace spec 树 ``knowledge/decisions/*.md`` 条目（id/变更/理由——
  CLI ``buildResultFromPlatform`` 只认 ``decisions/`` 前缀），embedding 文本 =
  ``f"{anchor} {title}\n{reason}"``；rejected/死路条目照常入索引（策略面在 CLI
  本地解析——「平台只做语义召回」原则，本地文件是真相源）。
- **索引** = 进程内按 decisions 文件集指纹 ``(name, mtime_ns, size)`` 懒构建缓存
  （设计偏差：提案的 daemon sync 挂点灌索引改为查询时懒构建——语料量级 700-2400
  条秒级，免 daemon 改动，文件增删改自动失效自愈）。
- **相似度** = 归一化点积（余弦），纯 Python（2.4k×512 毫秒级，不引入 numpy 耦合；
  fastembed 自带 numpy 但不作为本模块直接依赖）。
"""

from __future__ import annotations

import re
import threading
from dataclasses import dataclass
from pathlib import Path

# ── 决策条目解析（对齐 CLI src/knowledge-match.js 的段格式子集）─────────────────

_DECISION_HEADING_RE = re.compile(r"^##\s+(D-(?:[A-Za-z0-9_\-\u4e00-\u9fff]+-)?\d+@v\d+)\s+(.*)$")
_DECISION_FIELD_RE = re.compile(r"^(状态|变更|理由|否决理由)\s*[：:]\s*(.*)$")


@dataclass(frozen=True, slots=True)
class DecisionEntry:
    """一条可检索的决策条目（对应 CLI 侧 parseDecisionEntries 单条）。"""

    spec_path: str  # "knowledge/decisions/<file>.md"（CLI spec_path 形态，POSIX）
    anchor: str  # D-xxx@vN（条目 id）
    change: str | None  # 「变更：」行（同号消歧用；缺省 None → CLI 同号全量带回）
    title: str
    text: str  # embedding 输入 = f"{anchor} {title}\n{reason}"


def parse_decision_entries(spec_root: Path) -> list[DecisionEntry]:
    """解析 spec 树 knowledge/decisions/*.md 为可检索条目（纯函数）。

    段格式：``## D-xxx@vN 标题`` 起头至下一个 ``## ``；字段行 ``状态/变更/理由/否决理由``。
    文件不存在/空目录 → 空列表（fail-soft，调用方按空语料处理）。
    """
    decisions_dir = spec_root / "knowledge" / "decisions"
    if not decisions_dir.is_dir():
        return []
    entries: list[DecisionEntry] = []
    for md in sorted(decisions_dir.glob("*.md")):
        try:
            content = md.read_text(encoding="utf-8", errors="replace")
        except OSError:
            continue
        collected: list[dict] = []
        cur: dict | None = None
        for line in content.splitlines():
            heading = _DECISION_HEADING_RE.match(line)
            if heading:
                if cur and cur.get("anchor"):
                    collected.append(cur)
                cur = {"anchor": heading.group(1), "title": heading.group(2).strip()}
                continue
            if cur is None:
                continue
            field = _DECISION_FIELD_RE.match(line)
            if field:
                key = field.group(1)
                if key == "变更":
                    cur["change"] = field.group(2).strip()
                elif key in ("理由", "否决理由") and not cur.get("reason"):
                    # 否决理由并入理由槽（embedding 文本同源；rejected 语义 CLI 本地判定）
                    cur["reason"] = field.group(2).strip()
        if cur and cur.get("anchor"):
            collected.append(cur)
        for c in collected:
            entries.append(
                DecisionEntry(
                    spec_path=f"knowledge/decisions/{md.name}".replace("\\", "/"),
                    anchor=c["anchor"],
                    change=c.get("change") or None,
                    title=c.get("title") or "",
                    text=f"{c['anchor']} {c.get('title') or ''}\n{c.get('reason') or ''}".strip(),
                )
            )
    return entries


def decisions_fingerprint(spec_root: Path) -> tuple | None:
    """decisions 文件集指纹：``tuple(sorted((name, mtime_ns, size)))``；目录缺席 → None。"""
    decisions_dir = spec_root / "knowledge" / "decisions"
    if not decisions_dir.is_dir():
        return None
    parts = []
    for md in decisions_dir.glob("*.md"):
        try:
            st = md.stat()
        except OSError:
            continue
        parts.append((md.name, st.st_mtime_ns, st.st_size))
    return tuple(sorted(parts))


# ── embedder（fastembed 懒加载单例；不可用态 fail-soft）────────────────────────

_embedder_lock = threading.Lock()
_embedder_instance: object | None = None
_embedder_model: str | None = None
_embedder_error: str | None = None


class FastembedEmbedder:
    """fastembed 封装（构造即加载模型——调用方持有单例，不反复初始化）。"""

    def __init__(self, model_name: str) -> None:
        from fastembed import TextEmbedding  # lazy import：缺席=不可用态，不阻塞启动

        self._model = TextEmbedding(model_name=model_name)

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for vec in self._model.embed(texts):
            out.append(vec.tolist() if hasattr(vec, "tolist") else [float(x) for x in vec])
        return out


def get_embedder(model_name: str) -> tuple[object | None, str | None]:
    """返回 ``(embedder | None, 不可用原因 | None)``；初始化失败缓存原因（进程级一次）。"""
    global _embedder_instance, _embedder_model, _embedder_error
    with _embedder_lock:
        if _embedder_instance is not None and _embedder_model == model_name:
            return _embedder_instance, None
        if _embedder_error is not None and _embedder_model == model_name:
            return None, _embedder_error
        try:
            _embedder_instance = FastembedEmbedder(model_name)
            _embedder_model = model_name
            _embedder_error = None
            return _embedder_instance, None
        except Exception as exc:  # 依赖缺席/模型下载失败/显存不足一律 fail-soft
            _embedder_instance = None
            _embedder_model = model_name
            _embedder_error = f"{type(exc).__name__}: {exc}"
            return None, _embedder_error


def reset_embedder_for_tests() -> None:
    """测试隔离：清空单例与错误缓存（生产勿调）。"""
    global _embedder_instance, _embedder_model, _embedder_error
    with _embedder_lock:
        _embedder_instance = None
        _embedder_model = None
        _embedder_error = None


# ── 索引（per-workspace 懒构建 + 指纹失效）与检索 ─────────────────────────────

_index_lock = threading.Lock()
_indexes: dict[
    tuple[str, str], dict
] = {}  # (workspace_id, model_name) → {fingerprint, entries, vectors}


def _normalize(vec: list[float]) -> list[float]:
    norm = sum(x * x for x in vec) ** 0.5
    return [x / norm for x in vec] if norm > 0 else vec


def _cosine_top_k(
    query_vec: list[float], entries: list[DecisionEntry], vectors: list[list[float]], limit: int
) -> list[dict]:
    q = _normalize(query_vec)
    scored = []
    for entry, vec in zip(entries, vectors, strict=True):
        v = _normalize(vec)
        score = sum(a * b for a, b in zip(q, v, strict=False))
        scored.append({"entry": entry, "score": score})
    scored.sort(key=lambda s: s["score"], reverse=True)
    return [
        {
            "spec_path": s["entry"].spec_path,
            "anchor": s["entry"].anchor,
            "change": s["entry"].change,
            "score": round(s["score"], 6),
        }
        for s in scored[:limit]
    ]


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
    """同步检索主体（路由侧经 run_in_threadpool 调用；embedder 参数供测试注入 fake）。

    返回 ``{results, model_ready, reason}``——embedder None（不可用）时 results 恒空。
    """
    if embedder is None:
        return {
            "results": [],
            "model_ready": False,
            "reason": embedder_error or "embedder unavailable",
        }
    q = str(query or "").strip()
    if not q:
        return {"results": [], "model_ready": True, "reason": None}
    fp = decisions_fingerprint(spec_root)
    if fp is None:
        return {"results": [], "model_ready": True, "reason": None}
    key = (workspace_key, model_name)
    with _index_lock:
        cached = _indexes.get(key)
        if cached is None or cached["fingerprint"] != fp:
            entries = parse_decision_entries(spec_root)
            vectors = embedder.embed([e.text for e in entries]) if entries else []
            cached = {"fingerprint": fp, "entries": entries, "vectors": vectors}
            _indexes[key] = cached
    results = _cosine_top_k(embedder.embed([q])[0], cached["entries"], cached["vectors"], limit)
    return {"results": results, "model_ready": True, "reason": None}


def reset_index_for_tests() -> None:
    """测试隔离：清空索引缓存（生产勿调）。"""
    with _index_lock:
        _indexes.clear()
