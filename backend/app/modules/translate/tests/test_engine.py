"""翻译子进程代理测试（fake worker 注入，不依赖 ctranslate2/模型下载）。

对齐 knowledge/tests/test_embedding_subprocess.py 的假 worker 模式：
- 行协议往返（假 worker 回显 "译:<len>" 形态）
- 闲置自灭后单次透明重启
- 连续崩溃 3 次进入退避与到点恢复
- get_translator fail-soft（构造异常缓存原因）
"""

from __future__ import annotations

import logging
import time
from pathlib import Path

import pytest

from app.modules.translate import engine
from app.modules.translate.engine import (
    TranslateSubprocessError,
    TranslateSubprocessProxy,
    get_translator,
    reset_translator_for_tests,
)

# -- 假 worker 脚本 ---------------------------------------------------------------

# 正常 worker：每条文本回显 "T:" 前缀；argv[2] 位置参数控制闲置闸（对齐真
# worker 的 <model_spec> [idle_exit_sec] 命令行形态）。
_FAKE_WORKER = """
import json, sys, time

idle = float(sys.argv[2]) if len(sys.argv) > 2 else 900.0
started = time.monotonic()
last = started
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
        resp = {"id": req.get("id"), "ok": True,
                "translations": ["T:" + t for t in texts]}
    except Exception as exc:
        resp = {"id": None, "ok": False, "error": str(exc)}
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\\n")
    sys.stdout.flush()
"""

# 模型加载失败 worker：打一行结构化错误后退出码 3（对齐真 worker 加载失败形态）。
_CRASH_WORKER = """
import json, sys
sys.stdout.write(json.dumps({"id": None, "ok": False, "error": "model load failed"}) + "\\n")
sys.stdout.flush()
sys.exit(3)
"""

# 沉默 worker：吃掉请求但永不响应（模拟子进程卡在模型下载/加载，2026-10-22
# 生产事故形态——主进程必须有超时兜底，不能无限等）。
_SILENT_WORKER = """
import sys
while True:
    line = sys.stdin.readline()
    if not line:
        break
"""

# stderr 留痕 worker：启动先往 stderr 写一行错误，再正常处理请求（验证 stderr
# 不再进 DEVNULL，而是转发到主进程 logger）。
_STDERR_WORKER = """
import json, sys
sys.stderr.write("model-download-stderr-marker: connect failed\\n")
sys.stderr.flush()
while True:
    line = sys.stdin.readline()
    if not line:
        break
    req = json.loads(line)
    resp = {"id": req.get("id"), "ok": True, "translations": ["T:" + t for t in req["texts"]]}
    sys.stdout.write(json.dumps(resp, ensure_ascii=False) + "\\n")
    sys.stdout.flush()
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


@pytest.fixture()
def silent_worker_path(tmp_path: Path) -> Path:
    p = tmp_path / "silent_worker.py"
    p.write_text(_SILENT_WORKER, encoding="utf-8")
    return p


@pytest.fixture()
def stderr_worker_path(tmp_path: Path) -> Path:
    p = tmp_path / "stderr_worker.py"
    p.write_text(_STDERR_WORKER, encoding="utf-8")
    return p


@pytest.fixture(autouse=True)
def _reset_engine():
    reset_translator_for_tests()
    yield
    reset_translator_for_tests()


def _cmd(python_file: Path, idle: str = "900") -> list[str]:
    import sys

    return [sys.executable, str(python_file), "unused-model-spec", idle]


def test_protocol_roundtrip(fake_worker_path: Path) -> None:
    proxy = TranslateSubprocessProxy("unused", worker_cmd=_cmd(fake_worker_path))
    try:
        out = proxy.translate(["hello world", "second text"])
        assert out == ["T:hello world", "T:second text"]
        # 二次调用复用同一子进程（同实例连续往返）
        assert proxy.translate(["again"]) == ["T:again"]
    finally:
        proxy.close()


def test_idle_exit_then_transparent_restart(fake_worker_path: Path) -> None:
    proxy = TranslateSubprocessProxy("unused", worker_cmd=_cmd(fake_worker_path, idle="1"))
    try:
        assert proxy.translate(["first"]) == ["T:first"]
        time.sleep(1.5)  # 越过闲置闸 → 子进程自灭
        # 自灭后首次请求：单次透明重启重试，调用方等价"重启即恢复"
        assert proxy.translate(["second"]) == ["T:second"]
    finally:
        proxy.close()


def test_crash_backoff_and_recovery(fake_worker_path: Path, crash_worker_path: Path) -> None:
    proxy = TranslateSubprocessProxy("unused", worker_cmd=_cmd(crash_worker_path))
    try:
        # 连续崩溃：每次调用失败并累计 consecutive_crashes
        for _ in range(TranslateSubprocessProxy.MAX_CONSECUTIVE_CRASHES):
            with pytest.raises(TranslateSubprocessError):
                proxy.translate(["x"])
        assert not proxy.available
        assert proxy.retry_at > time.monotonic()
        # 退避期内：不拉子进程直接抛
        with pytest.raises(TranslateSubprocessError, match="backoff"):
            proxy.translate(["y"])
    finally:
        proxy.close()
    # 退避到点恢复：手动回拨 retry_at → available → 换正常 worker 语义由
    # get_translator 重建；此处直接验证 available 判定翻转
    proxy2 = TranslateSubprocessProxy("unused", worker_cmd=_cmd(fake_worker_path))
    proxy2.consecutive_crashes = TranslateSubprocessProxy.MAX_CONSECUTIVE_CRASHES
    proxy2.retry_at = time.monotonic() - 1  # 已过退避点
    assert proxy2.available
    proxy2.close()


def test_request_timeout_sec_override_fails_fast(silent_worker_path: Path) -> None:
    """卡死的子进程 != 无限等待：构造参数收紧超时后快速抛错（fail-soft 由上层做）。"""
    proxy = TranslateSubprocessProxy(
        "unused", request_timeout_sec=0.3, worker_cmd=_cmd(silent_worker_path)
    )
    try:
        started = time.monotonic()
        with pytest.raises(TranslateSubprocessError):
            proxy.translate(["x"])
        assert time.monotonic() - started < 5.0
    finally:
        proxy.close()


def test_request_timeout_scales_with_batch_size() -> None:
    """评审 P2：满批 16×1000 字符实测 21.5s，单一 20s 预算会误杀——按批线性放宽。"""
    proxy = TranslateSubprocessProxy("unused")
    try:
        assert proxy._timeout_for(1) == 20.0
        assert proxy._timeout_for(2) == 22.5
        assert proxy._timeout_for(16) == 57.5
    finally:
        proxy.close()


def test_request_timeout_default_from_settings() -> None:
    """缺省值来自 settings（默认 20s——2026-10-22 生产事故前是固定 300s）。"""
    from app.core.config import get_settings

    assert get_settings().translate_request_timeout_sec == 20.0
    proxy = TranslateSubprocessProxy("unused")
    try:
        assert proxy.request_timeout_sec == 20.0
    finally:
        proxy.close()


def test_worker_stderr_forwarded_to_logger(
    stderr_worker_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    """子进程 stderr 不进 DEVNULL：后台线程转发到主进程 logger（失败原因可查）。"""
    with caplog.at_level(logging.WARNING, logger="app.modules.translate.engine"):
        proxy = TranslateSubprocessProxy("unused", worker_cmd=_cmd(stderr_worker_path))
        try:
            assert proxy.translate(["hi"]) == ["T:hi"]
            deadline = time.monotonic() + 3.0
            while "model-download-stderr-marker" not in caplog.text and time.monotonic() < deadline:
                time.sleep(0.05)
        finally:
            proxy.close()
    assert "model-download-stderr-marker" in caplog.text


def test_get_translator_fail_soft_on_construction_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def _boom(*args: object, **kwargs: object) -> None:
        raise RuntimeError("no such setting")

    monkeypatch.setattr(engine, "TranslateSubprocessProxy", _boom)
    translator, reason = get_translator("spec-a")
    assert translator is None
    assert reason and "RuntimeError" in reason
    # 原因按 model_spec 缓存（进程级一次）
    translator2, reason2 = get_translator("spec-a")
    assert translator2 is None and reason2 == reason


def test_get_translator_returns_proxy_and_backoff_reason(fake_worker_path: Path) -> None:
    translator, reason = get_translator("unused")
    assert translator is not None and reason is None
    assert isinstance(translator, TranslateSubprocessProxy)
    # 拉入退避 → get_translator 报不可用
    translator.consecutive_crashes = TranslateSubprocessProxy.MAX_CONSECUTIVE_CRASHES
    translator.retry_at = time.monotonic() + 999
    translator2, reason2 = get_translator("unused")
    assert translator2 is None and reason2 and "unavailable" in reason2


def test_reader_writes_only_to_captured_queue() -> None:
    """2026-10-23-translate-budget-align / FR-03：读线程只写构造时捕获的队列。

    修复前 _reader 经 self._responses 属性写入：崩溃重启 _ensure_started 整体
    换队列后，旧读线程的 EOF 哨兵/迟到响应落入新队列 → 下次请求读到哨兵即
    "translate worker exited" 假崩溃，3 次即 600s 退避。修复后队列经参数捕获，
    旧线程只写旧队列（无人读，自然作废）。
    """
    import queue as _queue
    import threading as _threading

    proxy = TranslateSubprocessProxy("unused")
    try:
        captured = _queue.Queue()  # 旧线程启动时捕获的队列
        new_queue = _queue.Queue()  # 重启后的新队列（self._responses 已换）
        proxy._responses = new_queue
        thread = _threading.Thread(
            target=proxy._reader, args=(iter(["resp-a\n"]), captured), daemon=True
        )
        thread.start()
        thread.join(timeout=5.0)
        assert not thread.is_alive()
        # 响应行与 EOF 哨兵都只进 captured；new_queue 保持为空（无污染）
        assert captured.get(timeout=1.0) == "resp-a\n"
        sentinel = captured.get(timeout=1.0)
        assert not isinstance(sentinel, str)
        assert new_queue.empty()
    finally:
        proxy.close()
