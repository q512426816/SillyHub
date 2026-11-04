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
- **索引** = 进程内按 decisions 文件集指纹 ``(name, mtime_ns, size)`` 缓存（语料量级
  700-2400 条，文件增删改指纹失配自愈）。读路径去嵌入化（2026-11-05-knowledge-vector-
  async-refresh，迁移自 search.py 同名先例）：失配/缺索引时调度进程内后台线程重建
  （注册表在途判重，失败不重试自愈），请求即时返回存量索引或空结果——**禁止**在请求
  路径内同步重建（生产实证冷启动分钟级挂起：全量嵌入 + 容器内模型首用下载叠加）。
  ``settings.knowledge_search_server_build=False``（KNOWLEDGE_SEARCH_SERVER_BUILD=0）
  时后台构建一律不调度（「服务器禁建库」治理口径与 search.py 同源）。重建嵌入**必须**经
  ``_embed_corpus`` 按 32 条/批分批喂子进程（2026-11-02 生产 OOM 根治——单批全量
  ~2.4k 条曾把 worker RSS 推到 2.3~2.45GB，撞 2500m cgroup 配额被强杀 6 次）。
- **相似度** = 归一化点积（余弦），纯 Python（2.4k×512 毫秒级，不引入 numpy 耦合；
  fastembed 自带 numpy 但不作为本模块直接依赖）。
"""

from __future__ import annotations

import json
import queue
import re
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import structlog

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


# ── embedder（子进程封装；不可用态 fail-soft）──────────────────────────────────
#
# 2026-10-16-backend-mem-polling task-01 / D-001@v1：fastembed 模型从进程内单例
# 改为独立子进程（app.modules.knowledge.embedding_worker），主进程只持管道——
# 模型内存"用时有峰、闲时归零"（子进程三闸自灭=进程退出，内存确定性归还 OS）。
# 失败语义与旧版模型缺席一致（model_ready=false + 词面兜底），**不回退进程内加载**。

_embedder_lock = threading.Lock()
_embedder_instance: object | None = None
_embedder_model: str | None = None
_embedder_error: str | None = None

# 子进程连续崩溃达到阈值后的退避时长（防崩溃循环烧 CPU）
_EMBEDDER_CRASH_BACKOFF_SEC = 600.0


class EmbeddingSubprocessError(RuntimeError):
    """子进程嵌入失败（崩溃/超时/协议错误），调用方按 fail-soft 降级处理。"""


class EmbeddingSubprocessProxy:
    """fastembed 子进程代理——embed() 经 stdin/stdout 行协议往返，签名与旧
    ``FastembedEmbedder`` 一致（调用方 duck-typing 零改动）。

    - 子进程懒启动（首次 embed 才 spawn）；崩溃自动重启，连续
      ``MAX_CONSECUTIVE_CRASHES`` 次后进入不可用退避（``available=False``）；
      退避满 ``retry_at`` 后代理自身恢复可用（get_embedder 审查 available
      通过即复用原代理，embed 内懒重启子进程——不另建新代理实例）。
    - 响应读取用常驻读线程 + 队列（Windows 管道无 select）。
    - ``worker_cmd`` 仅测试注入假 worker 用；生产默认 -m 拉真 worker。
    """

    REQUEST_TIMEOUT_SEC = 300.0
    MAX_CONSECUTIVE_CRASHES = 3

    def __init__(
        self,
        model_name: str,
        idle_exit_sec: int = 900,
        worker_cmd: list[str] | None = None,
    ) -> None:
        import subprocess

        self._subprocess = subprocess
        self._model_name = model_name
        self._idle_exit_sec = idle_exit_sec
        self._worker_cmd = worker_cmd
        self._proc: object | None = None
        self._responses: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self._next_id = 0
        self.consecutive_crashes = 0
        self.retry_at = 0.0

    # -- 生命周期 -----------------------------------------------------------

    def _poll(self) -> int | None:
        return self._proc.poll() if self._proc is not None else 0

    def _stop(self) -> None:
        if self._proc is not None:
            try:
                self._proc.kill()
                self._proc.wait(timeout=5)
            except Exception:
                pass
        self._proc = None

    def _ensure_started(self) -> None:
        """确保子进程与读线程在位（懒启动 + 崩溃重启共用）。"""
        import threading as _threading

        if self._proc is not None and self._poll() is None:
            return
        self._stop()
        cmd = self._worker_cmd or [
            sys.executable,
            "-m",
            "app.modules.knowledge.embedding_worker",
            self._model_name,
            str(self._idle_exit_sec),
        ]
        self._responses = queue.Queue()
        self._proc = self._subprocess.Popen(
            cmd,
            stdin=self._subprocess.PIPE,
            stdout=self._subprocess.PIPE,
            stderr=self._subprocess.DEVNULL,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        _threading.Thread(target=self._reader, args=(self._proc.stdout,), daemon=True).start()

    def _reader(self, stdout: object) -> None:
        """读线程：响应行入队；EOF/断裂入哨兵。"""
        eof_resp = object()
        try:
            for line in stdout:
                self._responses.put(line)
        except Exception:
            pass
        finally:
            self._responses.put(eof_resp)

    # -- 对外接口（与 FastembedEmbedder 同签名）------------------------------

    @property
    def available(self) -> bool:
        """未进入崩溃退避期（True 时可继续 embed）。"""
        return self.consecutive_crashes < self.MAX_CONSECUTIVE_CRASHES or (
            time.monotonic() >= self.retry_at
        )

    def embed(self, texts: list[str], *, timeout_sec: float | None = None) -> list[list[float]]:
        """阻塞式嵌入一批文本；失败抛 EmbeddingSubprocessError（fail-soft 由调用方降级）。

        子进程自灭（闲置/寿命帽）后的首次请求做**单次透明重启重试**——对调用方
        等价于"重启即恢复"；重试仍失败或已进崩溃退避则抛。``timeout_sec`` 为本批
        等待上限（缺省 None=REQUEST_TIMEOUT_SEC 300s）——查询路单条嵌入传紧预算
        （_QUERY_EMBED_TIMEOUT_SEC），worker 挂起（模型下载死连等）不再拖满 300s。
        """
        if not self.available:
            raise EmbeddingSubprocessError(
                f"embedding subprocess in crash backoff until {self.retry_at:.0f}"
            )
        budget = timeout_sec if timeout_sec and timeout_sec > 0 else self.REQUEST_TIMEOUT_SEC
        deadline = time.monotonic() + budget
        with self._lock:
            attempts = 0
            while True:
                attempts += 1
                try:
                    self._ensure_started()
                    self._next_id += 1
                    rid = self._next_id
                    req_line = json.dumps({"id": rid, "op": "embed", "texts": texts})
                    self._proc.stdin.write(req_line + "\n")
                    self._proc.stdin.flush()
                    resp_line = self._responses.get(timeout=max(0.1, deadline - time.monotonic()))
                    if not isinstance(resp_line, str):
                        raise EmbeddingSubprocessError("embedding worker exited")
                    resp = json.loads(resp_line)
                    if not isinstance(resp, dict) or resp.get("id") != rid:
                        raise EmbeddingSubprocessError(f"protocol mismatch: {resp_line[:200]!r}")
                    if not resp.get("ok"):
                        raise EmbeddingSubprocessError(str(resp.get("error") or "embed failed"))
                    self.consecutive_crashes = 0
                    return resp["vectors"]
                except EmbeddingSubprocessError:
                    self._on_crash()
                    if attempts >= 2 or not self.available:
                        raise
                    continue  # 单次透明重启重试（覆盖闲置/寿命帽自灭场景）
                except Exception as exc:  # 管道断裂/超时/JSON 损坏一律按崩溃处理
                    self._on_crash()
                    raise EmbeddingSubprocessError(f"{type(exc).__name__}: {exc}") from exc

    def _on_crash(self) -> None:
        self._stop()
        self.consecutive_crashes += 1
        if self.consecutive_crashes >= self.MAX_CONSECUTIVE_CRASHES:
            self.retry_at = time.monotonic() + _EMBEDDER_CRASH_BACKOFF_SEC

    def close(self) -> None:
        with self._lock:
            self._stop()


def get_embedder(model_name: str) -> tuple[object | None, str | None]:
    """返回 ``(embedder | None, 不可用原因 | None)``。

    子进程代理懒启动（构造不 spawn，首次 embed 才拉起），构造失败缓存原因
    （进程级一次，到换模型为止）；连续崩溃进入退避期的代理在 ``retry_at``
    到点后由本入口重建新代理（旧代理条目替换）。
    """
    global _embedder_instance, _embedder_model, _embedder_error
    with _embedder_lock:
        if _embedder_instance is not None and _embedder_model == model_name:
            proxy = _embedder_instance
            assert isinstance(proxy, EmbeddingSubprocessProxy)
            if proxy.available:
                return proxy, None
            return None, _embedder_error or "embedding subprocess unavailable (crash backoff)"
        if _embedder_error is not None and _embedder_model == model_name:
            return None, _embedder_error
        try:
            from app.core.config import get_settings

            proxy = EmbeddingSubprocessProxy(
                model_name, idle_exit_sec=get_settings().knowledge_embedding_idle_exit_sec
            )
            _embedder_instance, _embedder_model, _embedder_error = proxy, model_name, None
            return proxy, None
        except Exception as exc:  # 依赖缺席/配置异常一律 fail-soft
            _embedder_instance, _embedder_model = None, model_name
            _embedder_error = f"{type(exc).__name__}: {exc}"
            return None, _embedder_error


def reset_embedder_for_tests() -> None:
    """测试隔离：清空单例与错误缓存（生产勿调）。"""
    global _embedder_instance, _embedder_model, _embedder_error
    with _embedder_lock:
        if isinstance(_embedder_instance, EmbeddingSubprocessProxy):
            _embedder_instance.close()
        _embedder_instance = None
        _embedder_model = None
        _embedder_error = None


# ── 索引（per-workspace 懒构建 + 指纹失效 + LRU 工作区上限）与检索 ─────────────

_index_lock = threading.Lock()
_indexes: dict[
    tuple[str, str], dict
] = {}  # (workspace_id, model_name) → {fingerprint, entries, vectors}；插入序=LRU 序


def _index_cache_max() -> int:
    """LRU 工作区上限（settings.knowledge_embedding_index_max_ws，默认 4）。"""
    from app.core.config import get_settings

    return max(1, get_settings().knowledge_embedding_index_max_ws)


def _index_cache_get(key: tuple[str, str]) -> dict | None:
    """取缓存并刷新 LRU 新鲜度（命中即移到最旧淘汰序末尾）。"""
    with _index_lock:
        cached = _indexes.get(key)
        if cached is not None:
            del _indexes[key]
            _indexes[key] = cached
        return cached


def _index_cache_put(key: tuple[str, str], value: dict) -> None:
    """写入并按 LRU 上限淘汰最久未用（本 key 刚写永不自淘汰）。"""
    with _index_lock:
        _indexes.pop(key, None)
        _indexes[key] = value
        while len(_indexes) > _index_cache_max():
            oldest = next(iter(_indexes))
            if oldest == key:
                break
            del _indexes[oldest]


def _normalize(vec: list[float]) -> list[float]:
    norm = sum(x * x for x in vec) ** 0.5
    return [x / norm for x in vec] if norm > 0 else vec


def _cosine_top_k(
    query_vec: list[float], entries: list[DecisionEntry], vectors: list[list[float]], limit: int
) -> list[dict]:
    q = _normalize(query_vec)
    scored: list[tuple[float, DecisionEntry]] = []
    for entry, vec in zip(entries, vectors, strict=True):
        v = _normalize(vec)
        score = sum(a * b for a, b in zip(q, v, strict=False))
        scored.append((score, entry))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        {
            "spec_path": entry.spec_path,
            "anchor": entry.anchor,
            "change": entry.change,
            "score": round(score, 6),
        }
        for score, entry in scored[:limit]
    ]


# 单次 embed 请求批大小上限：worker 子进程按请求整体解析 texts 并推理，单批过大会把
# worker RSS 推过容器配额（2026-11-02 生产 6 次 cgroup OOM：全量批 ~2.4k 条 → RSS
# 2.3~2.45GB 撞 2500m mem_limit）。索引重建必须经 _embed_corpus 分批喂。批大小生产
# A/B 实测（998 条真实语料）：64 → cgroup 峰值 2.09GiB（余量不足），32 → 1.47GiB
# 稳态 1.26GiB——推理瞬态随 batch×seq² 缩放，32 留 ~1GB 余量给并发 worker。
_EMBED_BATCH_SIZE = 32


def _embed_corpus(embedder: object, texts: list[str]) -> list[list[float]]:
    """按 ``_EMBED_BATCH_SIZE`` 分批嵌入并按序聚合（结果等价单次全量调用）。"""
    vectors: list[list[float]] = []
    for i in range(0, len(texts), _EMBED_BATCH_SIZE):
        vectors.extend(embedder.embed(texts[i : i + _EMBED_BATCH_SIZE]))
    return vectors


# ── 后台构建调度（2026-11-05-knowledge-vector-async-refresh）────────────────────
#
# 读路径与语料嵌入彻底解耦（stale-while-revalidate，迁移自 search.py 2026-11-03
# 同名先例）：检索只做只读判定（指纹 fresh/stale/missing），失配/缺索引时调度进程内
# 后台线程重建（注册表 = 在途判重 + Thread 强引用），请求即时返回存量索引或空结果。
# 生产实证（2026-11-05）：请求内同步全量嵌入 + 容器内模型首用下载 → 冷启动分钟级
# 挂起（CLI 3s 预算必超时）。失败只记日志不重试、下次查询指纹仍失配再调度（自愈，
# 对齐 search.py D-003「防周期空转」口径）。

logger = structlog.get_logger()

_bg_builds: dict[tuple[str, str], threading.Thread] = {}

# 查询路单条嵌入限时（秒）：worker 冷启（spawn+模型加载）1~3s 常态；挂起态（模型
# 下载死连等）不该把请求拖满 300s 批预算——CLI 消费方自身预算仅 3s，秒级降级即正确。
_QUERY_EMBED_TIMEOUT_SEC = 15.0


def _bg_build(spec_root: Path, key: tuple[str, str], embedder: object) -> None:
    """后台构建主体：指纹取建首（构建期语料再变 → 下次查询失配自愈再调度）。"""
    try:
        fp = decisions_fingerprint(spec_root)
        if fp is None:
            return
        entries = parse_decision_entries(spec_root)
        vectors = _embed_corpus(embedder, [e.text for e in entries])
        _index_cache_put(key, {"fingerprint": fp, "entries": entries, "vectors": vectors})
    except Exception as exc:
        logger.warning(
            "knowledge_vector.bg_build_failed",
            workspace=key[0],
            model=key[1],
            error=f"{type(exc).__name__}: {exc}",
        )
    finally:
        # 判重窗竞态下可能同键双线程：只清自己的注册（他线程仍受判重保护）
        if _bg_builds.get(key) is threading.current_thread():
            _bg_builds.pop(key, None)


def _schedule_background_build(spec_root: Path, key: tuple[str, str], embedder: object) -> None:
    """调度后台构建（在途即跳过；调用方不等待——读路径永不阻塞）。"""
    existing = _bg_builds.get(key)
    if existing is not None and existing.is_alive():
        return
    t = threading.Thread(
        target=_bg_build,
        args=(spec_root, key, embedder),
        daemon=True,
        name=f"vector-index-build:{key[0]}",
    )
    _bg_builds[key] = t
    t.start()


def await_background_builds_for_tests() -> None:
    """测试隔离：等待全部在途后台构建结束并清空注册表（生产勿调，reset_*_for_tests 族）。"""
    for t in list(_bg_builds.values()):
        t.join(timeout=30.0)
    _bg_builds.clear()


def search_sync(
    spec_root: Path,
    workspace_key: str,
    query: str,
    limit: int,
    embedder: object | None,
    model_name: str,
    *,
    embedder_error: str | None = None,
    server_build: bool = True,
) -> dict:
    """同步检索主体（路由侧经 run_in_threadpool 调用；embedder 参数供测试注入 fake）。

    返回 ``{results, model_ready, reason, index_sync?}``——读路径去嵌入化：missing
    即时空返回并调度后台首建（index_sync="scheduled"）；stale 用旧索引即时出结果并
    调度后台重建；fresh 直查。embedder None（不可用）时 results 恒空。查询向量嵌入
    带紧限时（_QUERY_EMBED_TIMEOUT_SEC），超时/失败 fail-soft 降级不抛。
    ``server_build=False``（「服务器禁建库」，router 从 settings 注入，与 search.py
    治理同源）时后台构建一律不调度：missing 返回 reason=index_not_built。
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
    cached = _index_cache_get(key)
    index_sync = None
    if cached is None or cached["fingerprint"] != fp:
        if not server_build:
            if cached is None:
                # 禁建库 + 无索引：词面/外部预建归消费方（CLI 本地降级），reason 对齐
                # search.py index_not_built 口径
                return {"results": [], "model_ready": True, "reason": "index_not_built"}
            # 禁建库 + 存量陈旧缓存：照常服务旧索引（仅不再重建）
        else:
            _schedule_background_build(spec_root, key, embedder)
            index_sync = "scheduled"
            if cached is None:
                return {
                    "results": [],
                    "model_ready": True,
                    "reason": None,
                    "index_sync": index_sync,
                }
    try:
        q_vec = embedder.embed([q], timeout_sec=_QUERY_EMBED_TIMEOUT_SEC)[0]
    except Exception as exc:
        out = {"results": [], "model_ready": False, "reason": f"{type(exc).__name__}: {exc}"}
        if index_sync:
            out["index_sync"] = index_sync
        return out
    results = _cosine_top_k(q_vec, cached["entries"], cached["vectors"], limit)
    out = {"results": results, "model_ready": True, "reason": None}
    if index_sync:
        out["index_sync"] = index_sync
    return out


def reset_index_for_tests() -> None:
    """测试隔离：清空索引缓存（生产勿调）。"""
    with _index_lock:
        _indexes.clear()
