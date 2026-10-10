"""Tests for ``Settings.db_pool_size`` / ``db_max_overflow`` (2026-10-10-server-db-pool-tuning).

背景：阿里云生产服务器（2C/1.6G）内存不足持续 swap，postgres 常驻 13 个 idle 连接。
池参数经环境变量 DB_POOL_SIZE / DB_MAX_OVERFLOW 可配，默认 20/30 保持原调优值。

覆盖：默认值（FR-01 未配置场景）、环境变量覆盖（Settings 层 + get_engine 实际
engine pool 参数）、非法值显式 ValidationError（FR-02，选报错路线非静默回退）。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

import app.core.db as db_mod
from app.core.config import Settings


def _make(**overrides) -> Settings:
    """Construct Settings with required fields filled to avoid ValidationError noise."""
    base = {
        "database_url": "sqlite+aiosqlite:///:memory:",
        "secret_key": "x" * 16,
    }
    base.update(overrides)
    return Settings(**base)


class TestPoolDefaults:
    def test_default_pool_values(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # FR-01：未配置环境变量时默认 20/30，与 db.py 原常量一致（现行为不变）
        monkeypatch.delenv("DB_POOL_SIZE", raising=False)
        monkeypatch.delenv("DB_MAX_OVERFLOW", raising=False)
        s = _make()
        assert s.db_pool_size == 20
        assert s.db_max_overflow == 30


class TestPoolEnvOverride:
    def test_env_override_settings_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DB_POOL_SIZE", "5")
        monkeypatch.setenv("DB_MAX_OVERFLOW", "10")
        s = _make()
        assert s.db_pool_size == 5
        assert s.db_max_overflow == 10

    def test_env_override_engine_pool_params(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # FR-01：get_engine() 把 settings 值传进 create_async_engine（引擎层生效）。
        # URL 用 postgres 形式（engine 惰性创建不真连库）；sqlite/StaticPool
        # 不接受 pool_size 系参数——db.py 池参数本来就仅 asyncpg(PG) 路径生效。
        monkeypatch.setenv("DB_POOL_SIZE", "5")
        monkeypatch.setenv("DB_MAX_OVERFLOW", "10")
        monkeypatch.setattr(
            db_mod,
            "get_settings",
            lambda: _make(database_url="postgresql+asyncpg://u:p@h:5432/d"),
        )
        captured: dict = {}
        real_create = db_mod.create_async_engine

        def spy(url, **kwargs):
            captured.update(kwargs)
            return real_create(url, **kwargs)

        monkeypatch.setattr(db_mod, "create_async_engine", spy)
        monkeypatch.setattr(db_mod, "_engine", None)
        try:
            engine = db_mod.get_engine()
            assert captured["pool_size"] == 5
            assert captured["max_overflow"] == 10
            assert engine.pool.size() == 5
        finally:
            db_mod._engine = None
            db_mod._SessionFactory = None


class TestPoolInvalidValue:
    @pytest.mark.parametrize(
        "env_name,raw,field_name",
        [
            ("DB_POOL_SIZE", "abc", "db_pool_size"),  # 非整数
            ("DB_POOL_SIZE", "0", "db_pool_size"),  # 越界：pool_size >= 1
            ("DB_MAX_OVERFLOW", "-1", "db_max_overflow"),  # 越界：max_overflow >= 0
            ("DB_MAX_OVERFLOW", "1.5", "db_max_overflow"),  # 非整数
        ],
    )
    def test_invalid_pool_value_raises(
        self, monkeypatch: pytest.MonkeyPatch, env_name: str, raw: str, field_name: str
    ) -> None:
        # FR-02：非法值显式报错（fail fast），禁止静默回退默认值
        monkeypatch.setenv(env_name, raw)
        with pytest.raises(ValidationError, match=field_name):
            _make()
