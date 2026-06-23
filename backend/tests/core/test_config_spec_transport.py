"""Tests for ``Settings.spec_transport`` field (task-01).

Covers FR-01, D-001@v1 (transport orthogonal to strategy, not persisted),
D-002@v1 (global env SPEC_TRANSPORT=shared|tar, default shared, normalization).

Cases mirror blueprint task-01 §TDD 用例 + §边界处理 1-7.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings, get_settings


def _make(**overrides: str) -> Settings:
    """Construct Settings with required fields filled to avoid ValidationError noise."""
    base = {
        "database_url": "postgresql+asyncpg://u:p@h:5432/d",
        "secret_key": "x" * 16,
    }
    base.update(overrides)
    return Settings(**base)


class TestSpecTransportDefault:
    def test_default_is_shared(self) -> None:
        s = _make()
        assert s.spec_transport == "shared"

    def test_env_not_set_uses_shared(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # AC-2: 未设 SPEC_TRANSPORT env 时值为 shared，启动不报错
        monkeypatch.delenv("SPEC_TRANSPORT", raising=False)
        get_settings.cache_clear()
        try:
            assert (
                Settings(
                    database_url="postgresql+asyncpg://u:p@h:5432/d", secret_key="x" * 16
                ).spec_transport
                == "shared"
            )
        finally:
            get_settings.cache_clear()


class TestSpecTransportValid:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("shared", "shared"),
            ("tar", "tar"),
            ("SHARED", "shared"),  # 大写（边界 3 / AC-4）
            ("Tar", "tar"),
            (" shared ", "shared"),  # 前后空格
            ("TAR", "tar"),
        ],
    )
    def test_normalization(self, raw: str, expected: str) -> None:
        s = _make(spec_transport=raw)
        assert s.spec_transport == expected


class TestSpecTransportInvalid:
    @pytest.mark.parametrize("bad", ["http", "ftp", "local", "shard", "tar1", "x"])
    def test_invalid_enum_raises(self, bad: str) -> None:
        # AC-5: 非法枚举值抛 ValidationError
        with pytest.raises(ValidationError):
            _make(spec_transport=bad)

    def test_empty_string_raises(self) -> None:
        # AC-6 / 边界 4: SPEC_TRANSPORT= 视为已设空串，不回退 default，显式报错
        with pytest.raises(ValidationError):
            _make(spec_transport="")


class TestSpecTransportIsolation:
    def test_does_not_touch_spec_data_host_dir(self) -> None:
        # 边界 5 / AC-7: 新字段独立，不与现有 spec 路径字段交互
        s = _make(spec_transport="tar")
        assert s.spec_data_host_dir  # 非空，保持默认
        assert s.spec_data_root  # 非空

    def test_strategy_orthogonal(self) -> None:
        # D-001: transport 与 strategy 正交，config 层无法测表，但可断言字段存在且独立
        s = _make(spec_transport="tar")
        assert hasattr(s, "spec_transport")
