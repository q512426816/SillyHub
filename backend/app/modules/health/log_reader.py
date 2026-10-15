"""服务器日志读取与解析（2026-10-15-server-logs-panel task-02 / D-002@v1 / D-008@v1）。

- 读取面：``read_log_tail(path, n)`` 全文按块读入 splitlines 得 total_lines、取尾 n 行
  （单文件受 5MB 轮转上限天然封顶，轮询面毫秒级）；
- 解析面：JSON 行 → {time, level, event, fields}；非 JSON 行原文降级（raw + parse_error，
  不丢行）；
- 白名单：文件名（防目录遍历）与 lines 取值口径（D-008@v1：非白名单回退 200）。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import BaseModel

# 下载文件名白名单（防目录遍历——任何拼接用户输入的路径形态都不构造）。
LOG_FILE_WHITELIST: tuple[str, ...] = (
    "backend.log",
    "backend.log.1",
    "backend.log.2",
    "backend.log.3",
)
# 行数白名单（D-008@v1；非白名单值回退 DEFAULT_LOG_LINES）。
LOG_LINES_WHITELIST: tuple[int, ...] = (100, 200, 500, 1000)
DEFAULT_LOG_LINES = 200


class LogEntry(BaseModel):
    """单条日志（双形态：解析成功=time/level/event/fields；失败=raw+parse_error）。"""

    time: str | None = None
    level: str | None = None
    event: str | None = None
    fields: dict[str, Any] = {}
    raw: str | None = None
    parse_error: bool = False


class LogFileInfo(BaseModel):
    name: str
    size: int
    mtime: float


class ServerLogsResponse(BaseModel):
    file: str | None = None
    entries: list[LogEntry] = []
    total_lines: int = 0
    returned: int = 0
    available_files: list[LogFileInfo] = []
    hint: str | None = None


def normalize_lines(value: int | None) -> int:
    """lines 口径（D-008@v1）：白名单内原样，否则回退默认 200。"""
    return value if value in LOG_LINES_WHITELIST else DEFAULT_LOG_LINES


def read_log_tail(path: Path, n: int) -> tuple[list[str], int]:
    """读取文件尾部 n 行原文，返回 (尾部行, 文件总行数)。

    文件缺失/读失败 → ([], 0)（空态——不抛，页面显示提示）。
    """
    if not path.exists() or not path.is_file():
        return [], 0
    try:
        with path.open("r", encoding="utf-8", errors="replace") as f:
            lines = f.read().splitlines()
    except OSError:
        return [], 0
    total = len(lines)
    return (lines[-n:] if n > 0 else []), total


def parse_log_lines(raw_lines: list[str]) -> list[LogEntry]:
    """JSON 行解析；非 JSON 行按原文降级展示（不丢行）。"""
    entries: list[LogEntry] = []
    for raw in raw_lines:
        stripped = raw.strip()
        if not stripped:
            continue
        try:
            data = json.loads(stripped)
            if not isinstance(data, dict):
                raise ValueError("log line JSON is not an object")
        except (ValueError, TypeError):
            entries.append(LogEntry(raw=raw, parse_error=True))
            continue
        entries.append(
            LogEntry(
                time=str(data.get("timestamp", "")) or None,
                level=str(data.get("level", "")) or None,
                event=str(data.get("event", "")) or None,
                fields={k: v for k, v in data.items() if k not in ("timestamp", "level", "event")},
            )
        )
    return entries


def list_log_files(log_dir: Path) -> list[LogFileInfo]:
    """白名单中实际存在的文件清单（下载下拉与页脚数据源）。"""
    out: list[LogFileInfo] = []
    for name in LOG_FILE_WHITELIST:
        p = log_dir / name
        try:
            st = p.stat()
        except OSError:
            continue
        out.append(LogFileInfo(name=name, size=st.st_size, mtime=st.st_mtime))
    return out
