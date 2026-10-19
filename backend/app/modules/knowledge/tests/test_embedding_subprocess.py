"""task-01 子进程嵌入封装测试（2026-10-16-backend-mem-polling / D-001@v1）。

用假 worker（临时 python 脚本说同款行协议）注入 ``worker_cmd`` 测代理全路径——
不依赖 fastembed/模型下载（CI 无外网也能跑）。

覆盖：
- 行协议往返（假 worker 回显 [[len(t)] for t in texts]）
- 闲置自灭后重启（假 worker idle_exit_sec=1 → 1.2s 后进程自退 → 再 embed 重启）
- 连续崩溃 3 次进入退避（available=False / retry_at 未来）与退避到点恢复
- get_embedder fail-soft（构造异常缓存原因；崩溃退避期返回 None+reason）
- _index_cache_put/get LRU 上限淘汰与新鲜度刷新
- worker 纯函数（_reader EOF 哨兵 / _reset_oom_score 跨平台 fail-soft）
"""

from __future__ import annotations

import io
import time
from pathlib import Path

import pytest

from app.modules.knowledge import vector_search as vs
from app.modules.knowledge.embedding_worker import _reader_thread, _reset_oom_score
from app.modules.knowledge.vector_search import (
    EmbeddingSubprocessError,
    EmbeddingSubprocessProxy,
)

# -- 假 worker 脚本 ---------------------------------------------------------------

# 正常 worker：回显每条文本长度作向量；idle_exit_sec 位置参数控制闲置闸。
_FAKE_WORKER = """
import json, sys, time

idle = float(sys.argv[1]) if len(sys.argv) > 1 else 900.0
started = time.monotonic()
last = started
buf = ""
while True:
    now = time.monotonic()
    if now - last >= idle or now - started >= 3600.0:
        break
    line = sys.stdin.readline()
    if not line:
        break
    last = time.monotonic()
    try:
        req = json.loads(line)
        texts = req["texts"]
        resp = {"id": req.get("id"), "ok": True, "vectors": [[float(len(t))] for t in texts]}
    except Exception as exc:
        resp = {"id": None, "ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(resp) + "\\n")
    sys.stdout.flush()
"""

# 崩溃 worker：立即退出（模拟模型加载失败/启动即死）。
_CRASH_WORKER = """
import sys
sys.exit(3)
"""


@pytest.fixture()
def fake_worker_path(tmp_path: Path) -> Path:
    p = tmp_path / "fake_worker.py"
    p.write_text(_FAKE_WORKER, encoding="utf-8")
    return p


@pytest.fixture()
def crash_worker_path(tmp_path: Path) -> Path:
    p = tmp_path / "crash_worker.py"
    p.write_text(_CRASH_WORKER, encoding="utf-8")
    return p


@pytest.fixture(autouse=True)
def _reset_embedder():
    vs.reset_embedder_for_tests()
    vs.reset_index_for_tests()
    yield
    vs.reset_embedder_for_tests()
    vs.reset_index_for_tests()


def _cmd(python_file: Path, idle: str = "900") -> list[str]:
    import sys

    return [sys.executable, str(python_file), idle]


# -- 代理行协议与生命周期 ------------------------------------------------------------


def test_proxy_embed_roundtrip(fake_worker_path: Path):
    proxy = EmbeddingSubprocessProxy("fake-model", worker_cmd=_cmd(fake_worker_path))
    try:
        assert proxy.embed(["ab", "cdef"]) == [[2.0], [4.0]]
        assert proxy.embed(["x"]) == [[1.0]]
        assert proxy.consecutive_crashes == 0
    finally:
        proxy.close()


def test_proxy_restarts_after_worker_idle_exit(fake_worker_path: Path):
    """闲置闸自灭后下一请求重新拉起（进程退出=内存归还，重启透明）。"""
    proxy = EmbeddingSubprocessProxy("fake-model", worker_cmd=_cmd(fake_worker_path, idle="1"))
    try:
        assert proxy.embed(["ab"]) == [[2.0]]
        time.sleep(1.5)  # 假 worker 闲置 1s 自灭
        assert proxy.embed(["abc"]) == [[3.0]]  # 重启后照常
    finally:
        proxy.close()


def test_proxy_consecutive_crash_backoff(crash_worker_path: Path):
    """连续 3 次崩溃进入退避（available=False），退避到点恢复可重试。"""
    proxy = EmbeddingSubprocessProxy("fake-model", worker_cmd=_cmd(crash_worker_path))
    try:
        for _ in range(3):
            with pytest.raises(EmbeddingSubprocessError):
                proxy.embed(["x"])
        assert proxy.consecutive_crashes == 3
        assert proxy.available is False
        assert proxy.retry_at > time.monotonic()
        # 退避到点后 available 翻真（get_embedder 据此重建）
        proxy.retry_at = time.monotonic() - 1
        assert proxy.available is True
    finally:
        proxy.close()


def test_proxy_crash_count_resets_on_success(fake_worker_path: Path):
    proxy = EmbeddingSubprocessProxy("fake-model", worker_cmd=_cmd(fake_worker_path))
    try:
        proxy._on_crash()
        proxy._on_crash()
        assert proxy.consecutive_crashes == 2
        assert proxy.embed(["ok"]) == [[2.0]]  # 成功清零
        assert proxy.consecutive_crashes == 0
    finally:
        proxy.close()


# -- get_embedder fail-soft ------------------------------------------------------------


def test_get_embedder_construction_error_cached(monkeypatch: pytest.MonkeyPatch):
    """构造异常 → (None, 原因)，且同模型名内缓存不重试；换模型名重置。"""

    def _boom(*_a, **_k):
        raise RuntimeError("config unavailable")

    monkeypatch.setattr(vs, "EmbeddingSubprocessProxy", _boom)
    emb, err = vs.get_embedder("m1")
    assert emb is None and err and "config unavailable" in err
    # 同模型缓存原因（不重试）
    emb2, err2 = vs.get_embedder("m1")
    assert emb2 is None and err2 == err
    monkeypatch.undo()
    # 换模型名 → 重新构造成功
    emb3, err3 = vs.get_embedder("m2")
    assert emb3 is not None and err3 is None


def test_get_embedder_backoff_window_returns_none(
    fake_worker_path: Path, monkeypatch: pytest.MonkeyPatch
):
    """代理进入崩溃退避期 → (None, reason)，不返回坏代理。"""
    proxy = EmbeddingSubprocessProxy("m1", worker_cmd=_cmd(fake_worker_path))
    monkeypatch.setattr(vs, "_embedder_instance", proxy, raising=False)
    monkeypatch.setattr(vs, "_embedder_model", "m1", raising=False)
    monkeypatch.setattr(vs, "_embedder_error", "embedding subprocess crash backoff", raising=False)
    proxy.consecutive_crashes = EmbeddingSubprocessProxy.MAX_CONSECUTIVE_CRASHES
    proxy.retry_at = time.monotonic() + 600
    emb, err = vs.get_embedder("m1")
    assert emb is None and err and "backoff" in err
    proxy.close()


# -- 索引 LRU 上限 ---------------------------------------------------------------------


def test_index_cache_lru_eviction(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(vs, "_index_cache_max", lambda: 2)
    k1, k2, k3 = ("ws1", "m"), ("ws2", "m"), ("ws3", "m")
    vs._index_cache_put(k1, {"fingerprint": 1})
    vs._index_cache_put(k2, {"fingerprint": 2})
    # k1 命中刷新新鲜度 → 淘汰的应是最久未用的 k2
    assert vs._index_cache_get(k1) == {"fingerprint": 1}
    vs._index_cache_put(k3, {"fingerprint": 3})
    assert vs._index_cache_get(k2) is None
    assert vs._index_cache_get(k1) == {"fingerprint": 1}
    assert vs._index_cache_get(k3) == {"fingerprint": 3}
    # 刚写入的 key 永不自淘汰（上限 2 但 3 个 key 里最新两个保留）
    assert len(vs._indexes) == 2


# -- worker 纯函数 ----------------------------------------------------------------------


def test_reader_thread_eof_sentinel():
    import queue as _queue

    q: _queue.Queue = _queue.Queue()
    _reader_thread(io.StringIO('{"id": 1}\n'), q)
    assert q.get_nowait() == '{"id": 1}\n'
    sentinel = q.get_nowait()
    assert sentinel is not None and not isinstance(sentinel, str)  # EOF 哨兵


def test_reset_oom_score_never_raises():
    # Windows/macOS 无 /proc → fail-soft 静默；POSIX 写 0 成功亦不抛
    _reset_oom_score()
