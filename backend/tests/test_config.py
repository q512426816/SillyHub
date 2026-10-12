"""Sanity tests for Settings parsing rules (no I/O)."""

from __future__ import annotations

from typing import Any

import pytest


def _settings_cls() -> Any:
    """直接取 Settings 类（env 在实例化时读取，无需 reload）。

    此前用 ``importlib.reload(app.core.config)`` 让新 env 生效——实际有害：
    reload 原地重执行模块产生新 Settings 类，而 conftest 的
    ``_reset_settings_cache`` 补的是旧类 ``__init__``（spec_data_root 指向
    worker 独立目录）；reload 后经新类/新 get_settings 实例化的 Settings
    不带补丁，spec_data_root 回退到继承的 controller pid 目录（xdist worker
    继承 controller 已 setdefault 的 SPEC_DATA_ROOT，worker 内 setdefault
    不覆盖）。seed_spec_root 写 worker 目录、workspace spec_root 落 pid 目录，
    reparse 扫空 → parsed=0 → dispatch/task 大面积连锁失败（CI Linux 必现，
    2026-08-14 起 7 run 全红）。pydantic-settings 本就在实例化时读 env，
    monkeypatch.setenv 后直接 ``Settings()`` 即可，reload 纯属多余。
    """
    from app.core.config import Settings

    return Settings


def test_cors_origins_accepts_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a, http://b, http://c")
    settings_cls = _settings_cls()
    s = settings_cls()
    assert s.cors_allowed_origins == ["http://a", "http://b", "http://c"]


def test_cors_origins_accepts_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", '["http://x","http://y"]')
    settings_cls = _settings_cls()
    s = settings_cls()
    assert s.cors_allowed_origins == ["http://x", "http://y"]


def test_secret_key_min_length(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "tiny")
    settings_cls = _settings_cls()
    with pytest.raises(ValueError):
        settings_cls()


# ── spec_backup_retention_days 值域校验（2026-10-12-spec-backup-retention-validation）──


@pytest.mark.parametrize("bad", ["0", "-3"])
def test_spec_backup_retention_days_rejects_non_positive(
    monkeypatch: pytest.MonkeyPatch, bad: str
) -> None:
    """0/负数构造期 fail-fast（P3-1）——误配进不了运行期，不可能全删备份。"""
    monkeypatch.setenv("SPEC_BACKUP_RETENTION_DAYS", bad)
    settings_cls = _settings_cls()
    with pytest.raises(ValueError, match="spec_backup_retention_days"):
        settings_cls()


def test_spec_backup_retention_days_accepts_none_and_positive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """合法值域：缺省 None（长期保留）与正整数（逃生门）原样保留，不抛。"""
    settings_cls = _settings_cls()
    monkeypatch.delenv("SPEC_BACKUP_RETENTION_DAYS", raising=False)
    assert settings_cls().spec_backup_retention_days is None

    monkeypatch.setenv("SPEC_BACKUP_RETENTION_DAYS", "90")
    assert settings_cls().spec_backup_retention_days == 90
