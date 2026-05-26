"""Sanity tests for Settings parsing rules (no I/O)."""

from __future__ import annotations

import importlib
from typing import Any

import pytest


def _reload_settings_class() -> Any:
    """Re-import config so freshly set env vars are picked up by ``Settings``."""
    import app.core.config as config_mod

    importlib.reload(config_mod)
    return config_mod.Settings


def test_cors_origins_accepts_csv(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", "http://a, http://b, http://c")
    settings_cls = _reload_settings_class()
    s = settings_cls()
    assert s.cors_allowed_origins == ["http://a", "http://b", "http://c"]


def test_cors_origins_accepts_json(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CORS_ALLOWED_ORIGINS", '["http://x","http://y"]')
    settings_cls = _reload_settings_class()
    s = settings_cls()
    assert s.cors_allowed_origins == ["http://x", "http://y"]


def test_secret_key_min_length(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "tiny")
    settings_cls = _reload_settings_class()
    with pytest.raises(ValueError):
        settings_cls()
