"""翻译子进程代理测试（fake worker 注入，不依赖 ctranslate2/模型下载）。

对齐 knowledge/tests/test_embedding_subprocess.py 的假 worker 模式：
- 行协议往返（假 worker 回显 "译:<len>" 形态）
- 闲置自灭后单次透明重启
- 连续崩溃 3 次进入退避与到点恢复
- get_translator fail-soft（构造异常缓存原因）
"""

from __future__ import annotations

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
