"""Mission patrol 配置字段测试（2026-08-21-mission-converge-patrol task-01 / FR-04）。

覆盖 design §3 四项 mission_patrol_* 配置：默认值、env 逐项覆盖、ge 下界约束。
照 test_config_auth.py 惯例（_base_kwargs 最小构造 + ValidationError 断言）。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import Settings


def _base_kwargs(**overrides):
    """最小合法 Settings 构造参数(database_url/secret_key 必填)。"""
    return {
        "database_url": "postgresql+asyncpg://u:p@localhost/db",
        "secret_key": "x" * 16,
        **overrides,
    }


class TestMissionPatrolDefaults:
    def test_defaults_true_60_60_30(self):
        """不设任何 MISSION_PATROL_* env 时默认 True/60/60/30(存量部署零配置可启动)。"""
        s = Settings(**_base_kwargs())
        assert s.mission_patrol_enabled is True
        assert s.mission_patrol_interval_seconds == 60
        assert s.mission_patrol_zombie_after_minutes == 60
        assert s.mission_patrol_revive_window_minutes == 30

    def test_env_override_enabled_false(self, monkeypatch):
        """MISSION_PATROL_ENABLED="false" 解析为 False(开关可关)。"""
        monkeypatch.setenv("MISSION_PATROL_ENABLED", "false")
        s = Settings(**_base_kwargs())
        assert s.mission_patrol_enabled is False

    def test_env_override_numeric_fields(self, monkeypatch):
        """三项数值配置经 MISSION_PATROL_* env 逐项覆盖生效。"""
        monkeypatch.setenv("MISSION_PATROL_INTERVAL_SECONDS", "120")
        monkeypatch.setenv("MISSION_PATROL_ZOMBIE_AFTER_MINUTES", "90")
        monkeypatch.setenv("MISSION_PATROL_REVIVE_WINDOW_MINUTES", "45")
        s = Settings(**_base_kwargs())
        assert s.mission_patrol_interval_seconds == 120
        assert s.mission_patrol_zombie_after_minutes == 90
        assert s.mission_patrol_revive_window_minutes == 45


class TestMissionPatrolBounds:
    def test_interval_below_10_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(mission_patrol_interval_seconds=9))

    def test_zombie_after_below_5_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(mission_patrol_zombie_after_minutes=4))

    def test_revive_window_below_5_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(mission_patrol_revive_window_minutes=4))

    def test_lower_bounds_allowed(self):
        """恰好 10/5/5 合法(ge 下界含端点)。"""
        s = Settings(
            **_base_kwargs(
                mission_patrol_interval_seconds=10,
                mission_patrol_zombie_after_minutes=5,
                mission_patrol_revive_window_minutes=5,
            )
        )
        assert s.mission_patrol_interval_seconds == 10
        assert s.mission_patrol_zombie_after_minutes == 5
        assert s.mission_patrol_revive_window_minutes == 5
