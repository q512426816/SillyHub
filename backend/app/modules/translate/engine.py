"""翻译子进程代理（change 2026-10-19-thinking-zh-translate）。

``TranslateSubprocessProxy`` 与 ``knowledge/vector_search.EmbeddingSubprocessProxy``
同款模式（2026-10-16-backend-mem-polling D-001@v1 的翻译版）：

- 子进程懒启动（首次 translate 才 spawn），行协议往返（Windows 管道无
  select → 常驻读线程 + 队列）；
- 崩溃自动重启 + 连续 ``MAX_CONSECUTIVE_CRASHES`` 次进入退避
  （``available=False``，退避满后懒重启恢复）；
- 模型内存"用时有峰、闲时归零"（worker 三闸自灭），不回退进程内加载。

worker 侧模型解析（本地目录优先 / HF 自动下载）见 translate_worker.py。
"""

from __future__ import annotations

import json
import queue
import sys
import threading
import time

_engine_lock = threading.Lock()
_engine_instance: object | None = None
_engine_model: str | None = None
_engine_error: str | None = None

# 子进程连续崩溃达到阈值后的退避时长（防崩溃循环烧 CPU）
_ENGINE_CRASH_BACKOFF_SEC = 600.0


class TranslateSubprocessError(RuntimeError):
    """翻译子进程失败（崩溃/超时/协议错误），调用方按 fail-soft 降级处理。"""


class TranslateSubprocessProxy:
    """CTranslate2 翻译子进程代理——translate() 经 stdin/stdout 行协议往返。

    - ``worker_cmd`` 仅测试注入假 worker 用；生产默认 -m 拉真 worker。
    - 响应读取用常驻读线程 + 队列（Windows 管道无 select）。
    """

    REQUEST_TIMEOUT_SEC = 300.0
    MAX_CONSECUTIVE_CRASHES = 3

    def __init__(
        self,
        model_spec: str,
        idle_exit_sec: int = 600,
        worker_cmd: list[str] | None = None,
    ) -> None:
        import subprocess

        self._subprocess = subprocess
        self._model_spec = model_spec
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
            "app.modules.translate.translate_worker",
            self._model_spec,
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

    # -- 对外接口 -----------------------------------------------------------

    @property
    def available(self) -> bool:
        """未进入崩溃退避期（True 时可继续 translate）。"""
        return self.consecutive_crashes < self.MAX_CONSECUTIVE_CRASHES or (
            time.monotonic() >= self.retry_at
        )

    def translate(self, texts: list[str]) -> list[str]:
        """阻塞式翻译一批文本；失败抛 TranslateSubprocessError（fail-soft 由调用方降级）。

        子进程自灭（闲置/寿命帽）后的首次请求做**单次透明重启重试**——对调用方
        等价于"重启即恢复"；重试仍失败或已进崩溃退避则抛。
        """
        if not self.available:
            raise TranslateSubprocessError(
                f"translate subprocess in crash backoff until {self.retry_at:.0f}"
            )
        deadline = time.monotonic() + self.REQUEST_TIMEOUT_SEC
        with self._lock:
            attempts = 0
            while True:
                attempts += 1
                try:
                    self._ensure_started()
                    self._next_id += 1
                    rid = self._next_id
                    req_line = json.dumps(
                        {"id": rid, "op": "translate", "texts": texts}, ensure_ascii=False
                    )
                    self._proc.stdin.write(req_line + "\n")
                    self._proc.stdin.flush()
                    resp_line = self._responses.get(timeout=max(0.1, deadline - time.monotonic()))
                    if not isinstance(resp_line, str):
                        raise TranslateSubprocessError("translate worker exited")
                    resp = json.loads(resp_line)
                    if not isinstance(resp, dict) or resp.get("id") != rid:
                        raise TranslateSubprocessError(f"protocol mismatch: {resp_line[:200]!r}")
                    if not resp.get("ok"):
                        raise TranslateSubprocessError(str(resp.get("error") or "translate failed"))
                    self.consecutive_crashes = 0
                    return resp["translations"]
                except TranslateSubprocessError:
                    self._on_crash()
                    if attempts >= 2 or not self.available:
                        raise
                    continue  # 单次透明重启重试（覆盖闲置/寿命帽自灭场景）
                except Exception as exc:  # 管道断裂/超时/JSON 损坏一律按崩溃处理
                    self._on_crash()
                    raise TranslateSubprocessError(f"{type(exc).__name__}: {exc}") from exc

    def _on_crash(self) -> None:
        self._stop()
        self.consecutive_crashes += 1
        if self.consecutive_crashes >= self.MAX_CONSECUTIVE_CRASHES:
            self.retry_at = time.monotonic() + _ENGINE_CRASH_BACKOFF_SEC

    def close(self) -> None:
        with self._lock:
            self._stop()


def get_translator(model_spec: str) -> tuple[object | None, str | None]:
    """返回 ``(translator | None, 不可用原因 | None)``——get_embedder 同款语义。

    代理懒启动（构造不 spawn，首次 translate 才拉起）；构造失败缓存原因
    （进程级一次，到换模型为止）；连续崩溃进入退避期的代理在 ``retry_at``
    到点后 ``available`` 判定自然翻回 True——本入口复用同一代理实例（其
    translate 内懒重启子进程），不重建新代理。
    """
    global _engine_instance, _engine_model, _engine_error
    with _engine_lock:
        if _engine_instance is not None and _engine_model == model_spec:
            proxy = _engine_instance
            assert isinstance(proxy, TranslateSubprocessProxy)
            if proxy.available:
                return proxy, None
            return None, _engine_error or "translate subprocess unavailable (crash backoff)"
        if _engine_error is not None and _engine_model == model_spec:
            return None, _engine_error
        try:
            from app.core.config import get_settings

            proxy = TranslateSubprocessProxy(
                model_spec, idle_exit_sec=get_settings().translate_worker_idle_exit_sec
            )
            _engine_instance, _engine_model, _engine_error = proxy, model_spec, None
            return proxy, None
        except Exception as exc:  # 配置异常一律 fail-soft
            _engine_instance, _engine_model = None, model_spec
            _engine_error = f"{type(exc).__name__}: {exc}"
            return None, _engine_error


def reset_translator_for_tests() -> None:
    """测试隔离：清空单例与错误缓存（生产勿调）。"""
    global _engine_instance, _engine_model, _engine_error
    with _engine_lock:
        if isinstance(_engine_instance, TranslateSubprocessProxy):
            _engine_instance.close()
        _engine_instance = None
        _engine_model = None
        _engine_error = None
