"""Tests for Auth 配置字段(task-01)。

覆盖 FR-03、D-002@v1(refresh grace=60s)、D-003@v1(access TTL 15→30min)。
用例对应蓝图 task-01 §TDD + §边界处理 B-01..B-07。
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


class TestAuthRefreshGraceSeconds:
    def test_default_is_60(self):
        s = Settings(**_base_kwargs())
        assert s.auth_refresh_grace_seconds == 60

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("AUTH_REFRESH_GRACE_SECONDS", "120")
        s = Settings(**_base_kwargs())
        assert s.auth_refresh_grace_seconds == 120

    def test_zero_allowed_degrades_to_legacy(self):
        """grace=0 合法,退化为旧行为(回退旋钮)。"""
        s = Settings(**_base_kwargs(auth_refresh_grace_seconds=0))
        assert s.auth_refresh_grace_seconds == 0

    def test_negative_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_refresh_grace_seconds=-1))

    def test_over_upper_bound_rejected(self):
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_refresh_grace_seconds=601))

    def test_upper_bound_600_allowed(self):
        s = Settings(**_base_kwargs(auth_refresh_grace_seconds=600))
        assert s.auth_refresh_grace_seconds == 600


class TestAuthAccessTtlDefault30:
    def test_default_is_30(self):
        s = Settings(**_base_kwargs())
        assert s.auth_access_ttl_minutes == 30

    def test_env_override_back_to_15(self, monkeypatch):
        """环境变量可覆盖回 15(验证可配置,非硬编码)。"""
        monkeypatch.setenv("AUTH_ACCESS_TTL_MINUTES", "15")
        s = Settings(**_base_kwargs())
        assert s.auth_access_ttl_minutes == 15

    def test_constraints_unchanged(self):
        """ge=1 / le=1440 约束未因默认值变更而破坏。"""
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_access_ttl_minutes=0))
        with pytest.raises(ValidationError):
            Settings(**_base_kwargs(auth_access_ttl_minutes=1441))
        s = Settings(**_base_kwargs(auth_access_ttl_minutes=1440))
        assert s.auth_access_ttl_minutes == 1440
