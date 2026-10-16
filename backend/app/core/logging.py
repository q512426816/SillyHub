"""Structured logging setup.

Logs are emitted as JSON on stderr by default, so they can be picked up by any
container log aggregator without further configuration.

2026-10-15-server-logs-panel（D-001@v1 / D-006@v1 / D-008@v1）起，日志同时写入
轮转文件（页面「服务器日志」卡展示与下载的单一来源）：FileWriter processor 插在
JSONRenderer 之前，用同一 JSONRenderer 实例渲染行文本，保证文件与 stderr 逐字
一致；per-write 即开即关句柄（常驻句柄在 Windows 会阻断 rename 轮转）。
"""

from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Any

import structlog

from app.core.paths import resolve_log_dir

# 轮转参数（模块级常量，非 settings——D-008@v1；需要时再升级为配置项）。
LOG_FILE_NAME = "backend.log"
LOG_MAX_BYTES = 5_000_000
LOG_BACKUP_COUNT = 3


def get_log_file_path(log_dir: str | None = None) -> Path:
    """当前日志文件绝对路径（单一源：写入侧与两个日志端点共用）。

    ``log_dir`` 缺省从 settings 读取（经 :func:`resolve_log_dir` 解析；
    空值 → ``<repo_root>/data/logs``）。
    """
    if log_dir is None:
        from app.core.config import get_settings

        log_dir = get_settings().log_dir
    return Path(resolve_log_dir(log_dir)) / LOG_FILE_NAME


class FileWriter:
    """structlog processor：把渲染后的日志行写入轮转文件。

    - 复用同一 ``JSONRenderer`` 实例渲染（与 stderr 输出逐字一致，含中文）；
    - per-write ``open(..., "a")`` 即开即关（跨平台 rename 轮转前提，CLAUDE.md 规则 13）；
    - 写/轮转任何异常均捕获降级（日志绝不拖垮业务进程）；
    - 返回 ``event_dict`` 原样透传给链上后续 processor（stderr 链路零扰动）。
    """

    def __init__(
        self,
        path: Path,
        max_bytes: int = LOG_MAX_BYTES,
        backup_count: int = LOG_BACKUP_COUNT,
    ) -> None:
        self._path = Path(path)
        self._max_bytes = max_bytes
        self._backup_count = backup_count
        self._renderer = structlog.processors.JSONRenderer()

    def __call__(self, logger: Any, method_name: str, event_dict: dict[str, Any]) -> dict[str, Any]:
        try:
            line = self._renderer(logger, method_name, event_dict)
            self._write(str(line))
        except Exception:
            pass
        return event_dict

    def _write(self, line: str) -> None:
        try:
            size = self._path.stat().st_size if self._path.exists() else 0
            if size and size + len(line.encode("utf-8")) > self._max_bytes:
                self._rotate()
        except OSError:
            pass  # stat 失败按不轮转处理，写路径自身另有兜底
        with self._path.open("a", encoding="utf-8") as f:
            f.write(line + "\n")

    def _rotate(self) -> None:
        """rename 链：.2→.3、.1→.2、log→.1（超 backup_count 的最旧随 unlink 删除）。"""
        try:
            for i in range(self._backup_count, 0, -1):
                src = self._path if i == 1 else self._path.with_name(f"{self._path.name}.{i - 1}")
                dst = self._path.with_name(f"{self._path.name}.{i}")
                if not src.exists():
                    continue
                if dst.exists():
                    dst.unlink()
                src.rename(dst)
        except OSError:
            pass  # rename/占用失败——继续写当前文件，下一轮再试


def configure_logging(level: str = "INFO") -> None:
    """Configure stdlib logging + structlog. Idempotent.

    附加轮转文件写入（FileWriter）；日志目录创建失败时降级 stderr-only
    （D-001@v1 故障面——建目录/IO 异常不影响进程启动）。
    """
    log_level = getattr(logging, level.upper(), logging.INFO)
    logging.basicConfig(
        format="%(message)s",
        stream=sys.stderr,
        level=log_level,
    )

    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    file_writer: FileWriter | None = None
    try:
        log_path = get_log_file_path()
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_writer = FileWriter(log_path)
    except OSError as exc:
        # 降级必须留痕（2026-10-15-server-logs-dockerfile-fix）：容器内目录权限
        # 被拒时静默退回 stderr-only，页面日志卡只剩「尚未生成」无从排查——
        # 直接往 stderr 打一条含原因的可见警告（容器日志 docker logs 可查）。
        file_writer = None
        print(
            f"[logging] 文件日志不可用，已降级为仅 stderr 输出：{type(exc).__name__}: {exc}",
            file=sys.stderr,
            flush=True,
        )

    # FileWriter 插在 JSONRenderer 之前：先写文件（自渲染）、再透传由
    # JSONRenderer 渲染输出 stderr——两份 JSON 同源同构。
    processors: list[Any] = [*shared_processors]
    if file_writer is not None:
        processors.append(file_writer)
    processors.append(structlog.processors.JSONRenderer())

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Return a configured structlog logger."""
    return structlog.get_logger(name)
