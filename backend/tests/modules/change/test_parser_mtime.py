# ql-20260814-006 parser mtime 防御性转换测试

"""覆盖 `_safe_mtime`（ql-20260814-006）：
- 正常 mtime 原样转换
- year 30828 级垃圾值（实测脏值）→ 回退 epoch 0
- 负值 / nan / datetime.max 边界 → 回退或安全转换
- `_parse_change` 集成：monkeypatch stat 脏 mtime，解析不抛异常且 last_modified_at 落 1970-01-01
"""

import math
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.modules.change.parser import (
    _MTIME_EPOCH_MAX,
    ChangeParser,
    ParsedChange,
    _safe_mtime,
)


class TestSafeMtime:
    def test_normal_mtime_passthrough(self):
        mtime = 1_770_000_000.0  # 2026-02 左右
        assert _safe_mtime(mtime) == datetime.fromtimestamp(mtime, tz=UTC)

    def test_epoch_zero_passthrough(self):
        # mtime=0 合法（挂载层也真实返回过），应得到 1970-01-01 而非异常
        assert _safe_mtime(0.0) == datetime(1970, 1, 1, tzinfo=UTC)

    def test_dirty_year_30828_falls_back(self):
        # 实测脏值：year 30828 ≈ 9.1e11 秒（ns 值被当秒解析）。注意 Windows
        # fromtimestamp 上界是 year 3000（OSError），Linux 是 year MAXYEAR
        # （9.1e11 秒在两平台均越界抛异常——year 5103 量级的 9.8e10 只在
        # Windows 越界，Linux 合法，勿用）。
        dirty = 9.1e11
        with pytest.raises((ValueError, OverflowError, OSError)):
            datetime.fromtimestamp(dirty)  # 直接转换确实越界（两平台一致）
        assert _safe_mtime(dirty) == datetime(1970, 1, 1, tzinfo=UTC)

    def test_negative_falls_back(self):
        assert _safe_mtime(-1.0) == datetime(1970, 1, 1, tzinfo=UTC)

    def test_nan_falls_back(self):
        # NaN 比较全为 False，须靠 fromtimestamp 的 ValueError 兜底
        assert _safe_mtime(math.nan) == datetime(1970, 1, 1, tzinfo=UTC)

    def test_infinity_falls_back(self):
        assert _safe_mtime(math.inf) == datetime(1970, 1, 1, tzinfo=UTC)

    def test_just_below_max_no_crash(self):
        # 上界附近不再抛异常（Windows fromtimestamp 对远未来会抛 OSError，
        # 兜底后得到 epoch 0 或合法值均可，契约是"不炸"）
        val = _MTIME_EPOCH_MAX - 1
        result = _safe_mtime(val)
        assert isinstance(result, datetime)

    def test_above_max_falls_back(self):
        val = _MTIME_EPOCH_MAX + 86_400 * 2
        with pytest.raises((ValueError, OverflowError, OSError)):
            datetime.fromtimestamp(val, tz=UTC)
        assert _safe_mtime(val) == datetime(1970, 1, 1, tzinfo=UTC)


class TestParseChangeDirtyMtime:
    def test_dirty_mtime_does_not_break_parse(self, tmp_path: Path, monkeypatch):
        """集成：_parse_change 遇脏 mtime 文件不再抛 ValueError 打断全量 reparse。"""
        change_dir = tmp_path / "changes" / "2026-08-14-demo"
        change_dir.mkdir(parents=True)
        (change_dir / "proposal.md").write_text("# Demo\n", encoding="utf-8")

        real_stat = Path.stat

        class _DirtyStat:
            """Path.stat 的替身：只改 st_mtime，其余透传真实值。"""

            def __init__(self, real):
                self._real = real

            def __getattr__(self, name):
                return getattr(self._real, name)

            @property
            def st_mtime(self):
                return 9.1e11  # year 30828 脏值（两平台 fromtimestamp 均越界）

        def dirty_stat(self, *, follow_symlinks=True):
            return _DirtyStat(real_stat(self, follow_symlinks=follow_symlinks))

        monkeypatch.setattr(Path, "stat", dirty_stat)
        parser = ChangeParser()
        # 旧实现这里抛 ValueError: year 30828 is out of range
        parsed = parser._parse_change(
            tmp_path, change_dir, location="active", rel_prefix="changes/2026-08-14-demo"
        )
        assert isinstance(parsed, ParsedChange)
        proposal_doc = next(d for d in parsed.docs if d.doc_type == "proposal")
        assert proposal_doc.exists
        assert proposal_doc.last_modified_at == datetime(1970, 1, 1, tzinfo=UTC)

    def test_compute_last_modified_dirty_entry_skipped(self, tmp_path: Path):
        """_compute_last_modified 对普通目录正常返回（datetime 或 None，不抛异常）。

        DirEntry.stat 是 C 实现无法 monkeypatch；_compute_last_modified 内部
        已统一走 _safe_mtime，脏值行为由上面的单元测试覆盖。
        """
        change_dir = tmp_path / "changes" / "2026-08-14-demo"
        change_dir.mkdir(parents=True)
        (change_dir / "proposal.md").write_text("# Demo\n", encoding="utf-8")
        result = ChangeParser._compute_last_modified(change_dir)
        assert result is None or isinstance(result, datetime)
