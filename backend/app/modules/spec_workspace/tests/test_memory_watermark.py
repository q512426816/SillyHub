"""内存水位 cgroup v2 兼容用例（2026-10-28-cgroup-v2-watermark-fix）。

生产背景：60629d2bb 落地的水位预警 _CGROUP_LIMIT_FILES 首候选误写 v2 统一层级
不存在的 /sys/fs/cgroup/memory.limit（v2 实为 memory.max）——纯 v2 宿主
（现代容器默认形态）current 可读而 limit 恒 None，告警静默失效且与「无
cgroup 环境」不可区分。本文件锁定四形态 + 生产候选表常量：

- v2 正常形态：memory.current / memory.max 读出 → 计算比例落 info；
- 超 0.8 阈值：落 memory_watermark_high warning；
- memory.max 字面量 "max"（无限制）：安全跳过（None、零告警、不抛错）；
- 无 cgroup 环境：None 静默（与 test_archive_scoped_reparse.py 既有回归互补）。

log 断言走模块 log 符号替身——structlog PrintLoggerFactory 直写 stderr，
caplog 抓不到（test_session_readiness.py:336-342 同款惯例）。

author: qinyi
created_at: 2026-10-28
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.modules.spec_workspace import drift_probe


def _install_fake_cgroup(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    *,
    current_text: str | None,
    limit_text: str | None,
    limit_filename: str = "memory.max",
) -> MagicMock:
    """注入假 cgroup 文件 + log 替身；text 为 None 表示该文件不创建。"""
    current_file = tmp_path / "memory.current"
    if current_text is not None:
        current_file.write_text(current_text, encoding="utf-8")
    limit_file = tmp_path / limit_filename
    if limit_text is not None:
        limit_file.write_text(limit_text, encoding="utf-8")
    log_spy = MagicMock()
    monkeypatch.setattr(drift_probe, "_CGROUP_CURRENT_FILES", (str(current_file),))
    monkeypatch.setattr(drift_probe, "_CGROUP_LIMIT_FILES", (str(limit_file),))
    monkeypatch.setattr(drift_probe, "log", log_spy)
    monkeypatch.setattr(drift_probe, "_watermark_env_missing_logged", False)
    return log_spy


def test_v2_limit_read_returns_ratio(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """v2 形态（memory.current + memory.max）：读出限制并算出比例（FR-01）。"""
    spy = _install_fake_cgroup(monkeypatch, tmp_path, current_text="1000", limit_text="2000")
    ratio = drift_probe.log_memory_watermark()
    assert ratio == 0.5
    assert spy.info.call_count == 1
    assert spy.info.call_args.args[0] == "spec_workspace.memory_watermark"
    assert spy.info.call_args.kwargs["ratio"] == 0.5


def test_v2_ratio_above_threshold_warns(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """v2 形态超 0.8 阈值：落 memory_watermark_high warning（FR-03）。"""
    spy = _install_fake_cgroup(monkeypatch, tmp_path, current_text="1900", limit_text="2000")
    ratio = drift_probe.log_memory_watermark()
    assert ratio == 0.95
    assert spy.warning.call_count == 1
    assert spy.warning.call_args.args[0] == "spec_workspace.memory_watermark_high"


def test_v2_max_literal_skips_watermark(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """memory.max 字面量 "max"（无限制）：None、零告警、不抛错（FR-02）。"""
    spy = _install_fake_cgroup(monkeypatch, tmp_path, current_text="800", limit_text="max")
    assert drift_probe.log_memory_watermark() is None
    assert spy.warning.call_count == 0
    assert spy.info.call_count == 0


def test_watermark_silent_without_cgroup(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """无 cgroup 环境（本地 dev/Windows）：None 不抛错（R-05 同款回归）。"""
    _install_fake_cgroup(monkeypatch, tmp_path, current_text=None, limit_text=None)
    assert drift_probe.log_memory_watermark() is None


def test_production_limit_candidates_include_v2_memory_max() -> None:
    """生产候选表锁定：v2 memory.max 在列、不存在的 memory.limit 已移除。

    2026-10-28-cgroup-v2-watermark-fix 根因护栏——防止候选表回潮到 v2 失效形态。
    """
    assert "/sys/fs/cgroup/memory.max" in drift_probe._CGROUP_LIMIT_FILES
    assert "/sys/fs/cgroup/memory.limit" not in drift_probe._CGROUP_LIMIT_FILES
