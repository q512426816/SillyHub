"""日志轮转落盘测试（2026-10-15-server-logs-panel task-01 / D-001@v1 / D-006@v1）。

覆盖：
1. 轮转 rename 链（.1/.2/.3 与最旧删除，小 max_bytes 注入触发）；
2. 双写逐字一致（FileWriter 与 JSONRenderer 同一渲染语义，含中文 event）；
3. 写失败不抛（目录不存在 / 非法路径）；
4. configure_logging 幂等 + get_log_file_path 派生；
5. 轮转后文件句柄无残留（写后立即可 rename——Windows 语义）。
"""

from __future__ import annotations

import json
from pathlib import Path

import structlog

from app.core.logging import (
    LOG_BACKUP_COUNT,
    LOG_FILE_NAME,
    FileWriter,
    configure_logging,
    get_log_file_path,
)
from app.core.paths import resolve_log_dir


def _event(i: int, *, text: str = "ok") -> dict[str, object]:
    return {
        "event": f"test.event.{i}",
        "level": "info",
        "message": text,
        "idx": i,
    }


def _lines(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


# ── 轮转 ────────────────────────────────────────────────────────────────


def test_rotation_rename_chain_and_oldest_dropped(tmp_path: Path) -> None:
    """小 max_bytes 注入：多次写触发轮转，.1/.2/.3 链式后移、最旧删除。"""
    log_path = tmp_path / LOG_FILE_NAME
    writer = FileWriter(log_path, max_bytes=300, backup_count=3)

    for i in range(20):
        writer(None, "info", _event(i))

    assert log_path.exists(), "当前日志文件必须在"
    assert (tmp_path / f"{LOG_FILE_NAME}.1").exists(), "首次轮转须产生 .1"
    assert (tmp_path / f"{LOG_FILE_NAME}.2").exists(), "第二次轮转须产生 .2"
    assert (tmp_path / f"{LOG_FILE_NAME}.3").exists(), "第三次轮转须产生 .3"
    assert not (tmp_path / f"{LOG_FILE_NAME}.4").exists(), (
        "超 backup_count 的层级不得存在（最旧随 unlink 删除）"
    )
    # .1 为倒数第二个文件（比当前文件旧、比 .2 新）：行可解析且非空
    for name in (LOG_FILE_NAME, f"{LOG_FILE_NAME}.1", f"{LOG_FILE_NAME}.2"):
        assert _lines(tmp_path / name), f"{name} 不应为空"


def test_rotation_no_handle_residue(tmp_path: Path) -> None:
    """轮转后句柄无残留：写完后当前文件可被立即重命名（Windows 语义回归）。"""
    log_path = tmp_path / LOG_FILE_NAME
    writer = FileWriter(log_path, max_bytes=200, backup_count=2)
    for i in range(10):
        writer(None, "info", _event(i))

    renamed = tmp_path / "renamed.log"
    log_path.rename(renamed)  # 常驻句柄会在此处 Windows 失败
    assert renamed.exists()


# ── 双写一致性 ──────────────────────────────────────────────────────────


def test_file_line_matches_json_renderer_verbatim(tmp_path: Path) -> None:
    """文件行 == 同一 JSONRenderer 语义渲染（含中文 event 逐字一致）。"""
    log_path = tmp_path / LOG_FILE_NAME
    writer = FileWriter(log_path, max_bytes=10_000_000, backup_count=1)
    event: dict[str, object] = {
        "event": "中文事件.测试",
        "level": "warning",
        "detail": "内存使用率 87%",
        "idx": 1,
    }
    writer(None, "warning", dict(event))

    rendered = structlog.processors.JSONRenderer()(None, "warning", dict(event))
    assert _lines(log_path) == [str(rendered)]
    # JSONRenderer 默认 ensure_ascii=True（中文转义）——与 stderr 全等即一致性目标；
    # 解析后值必须与原始中文一致（转义无损）
    assert json.loads(_lines(log_path)[0])["event"] == "中文事件.测试"
    assert json.loads(_lines(log_path)[0])["detail"] == "内存使用率 87%"


# ── 失败降级 ────────────────────────────────────────────────────────────


def test_write_failure_does_not_raise(tmp_path: Path) -> None:
    """目标目录不存在（写失败）→ 不抛出，event_dict 原样透传。"""
    writer = FileWriter(tmp_path / "no-such-dir" / LOG_FILE_NAME)
    event = _event(1)
    out = writer(None, "info", dict(event))
    assert out == event, "processor 必须原样返回 event_dict 供后续输出"


def test_configure_idempotent_and_path_derivation(tmp_path: Path) -> None:
    """configure_logging 幂等；get_log_file_path 空值走默认派生、显式值尊重。"""
    configure_logging("INFO")
    configure_logging("INFO")  # 二次调用不抛

    assert get_log_file_path(str(tmp_path)) == tmp_path / LOG_FILE_NAME
    default_path = get_log_file_path("")
    assert default_path.name == LOG_FILE_NAME
    assert default_path.parent == Path(resolve_log_dir(""))
    assert str(default_path.parent).endswith(str(Path("data") / "logs"))


def test_resolve_log_dir_semantics() -> None:
    """resolve_log_dir：空=默认 repo_root/data/logs；绝对原样；相对对 repo_root。"""
    from app.core.paths import repo_root

    assert Path(resolve_log_dir("")) == repo_root() / "data" / "logs"
    assert Path(resolve_log_dir("   ")) == repo_root() / "data" / "logs"
    abs_dir = str((repo_root() / "custom-logs").resolve())
    assert resolve_log_dir(abs_dir) == abs_dir
    assert Path(resolve_log_dir("rel/logs")) == repo_root() / "rel" / "logs"


def test_backup_count_constant_default() -> None:
    """模块级轮转常量（D-008@v1 口径）：5MB×3。"""
    from app.core.logging import LOG_MAX_BYTES

    assert LOG_MAX_BYTES == 5_000_000
    assert LOG_BACKUP_COUNT == 3
