"""Tests for CredentialManager: local storage, placeholder rendering, env building."""

from __future__ import annotations

import json
import os
import stat
from unittest.mock import patch

import pytest

from sillyhub_daemon.credential import CredentialManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def cred_path(tmp_path):
    """Return a temp path for the credentials file."""
    return tmp_path / "credentials.json"


@pytest.fixture
def mgr(cred_path):
    """Create a CredentialManager with a temp file."""
    return CredentialManager(credentials_path=cred_path)


# ---------------------------------------------------------------------------
# _load / __init__
# ---------------------------------------------------------------------------


class TestLoad:
    def test_loads_existing_file(self, cred_path):
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        cred_path.write_text(json.dumps({"api_key": "sk-123"}), encoding="utf-8")

        mgr = CredentialManager(credentials_path=cred_path)

        assert mgr.get("api_key") == "sk-123"

    def test_empty_when_file_missing(self, cred_path):
        mgr = CredentialManager(credentials_path=cred_path)
        assert mgr.list_keys() == []

    def test_handles_corrupt_json(self, cred_path):
        cred_path.parent.mkdir(parents=True, exist_ok=True)
        cred_path.write_text("not json", encoding="utf-8")

        with pytest.raises(json.JSONDecodeError):
            CredentialManager(credentials_path=cred_path)


# ---------------------------------------------------------------------------
# save
# ---------------------------------------------------------------------------


class TestSave:
    def test_creates_parent_dirs(self, tmp_path):
        deep_path = tmp_path / "a" / "b" / "c" / "credentials.json"
        mgr = CredentialManager(credentials_path=deep_path)
        mgr.set("key", "val")

        assert deep_path.exists()

    def test_writes_valid_json(self, mgr, cred_path):
        mgr.set("alpha", "1")
        mgr.set("beta", "2")

        data = json.loads(cred_path.read_text(encoding="utf-8"))
        assert data == {"alpha": "1", "beta": "2"}

    def test_file_permissions(self, mgr, cred_path):
        mgr.set("key", "val")

        # On Windows chmod is a no-op for Unix permissions, so skip
        if os.name != "nt":
            mode = cred_path.stat().st_mode
            expected = stat.S_IRUSR | stat.S_IWUSR
            assert mode & 0o777 == expected


# ---------------------------------------------------------------------------
# get / set / remove / list_keys
# ---------------------------------------------------------------------------


class TestCrud:
    def test_get_returns_value(self, mgr):
        mgr.set("k", "v")
        assert mgr.get("k") == "v"

    def test_get_missing_returns_none(self, mgr):
        assert mgr.get("nonexistent") is None

    def test_set_overwrites(self, mgr):
        mgr.set("k", "old")
        mgr.set("k", "new")
        assert mgr.get("k") == "new"

    def test_remove_deletes_key(self, mgr):
        mgr.set("k", "v")
        mgr.remove("k")
        assert mgr.get("k") is None

    def test_remove_nonexistent_is_noop(self, mgr):
        mgr.remove("nope")  # should not raise

    def test_list_keys(self, mgr):
        mgr.set("a", "1")
        mgr.set("b", "2")
        assert sorted(mgr.list_keys()) == ["a", "b"]

    def test_list_keys_empty(self, mgr):
        assert mgr.list_keys() == []

    def test_set_persists_to_disk(self, mgr, cred_path):
        mgr.set("saved_key", "saved_val")

        # Reload from disk
        mgr2 = CredentialManager(credentials_path=cred_path)
        assert mgr2.get("saved_key") == "saved_val"


# ---------------------------------------------------------------------------
# render_config
# ---------------------------------------------------------------------------


class TestRenderConfig:
    def test_resolves_from_credentials(self, mgr):
        mgr.set("USER_ANTHROPIC_API_KEY", "sk-ant-real")

        config = {"anthropic_api_key": "{{USER_ANTHROPIC_API_KEY}}"}
        result = mgr.render_config(config)

        assert result["anthropic_api_key"] == "sk-ant-real"

    def test_resolves_from_env_fallback(self, mgr):
        with patch.dict(os.environ, {"USER_GITHUB_TOKEN": "ghp-abc"}, clear=False):
            config = {"github_token": "{{USER_GITHUB_TOKEN}}"}
            result = mgr.render_config(config)

            assert result["github_token"] == "ghp-abc"

    def test_credentials_take_priority_over_env(self, mgr):
        mgr.set("USER_MY_KEY", "from-file")
        with patch.dict(os.environ, {"USER_MY_KEY": "from-env"}, clear=False):
            config = {"my_key": "{{USER_MY_KEY}}"}
            result = mgr.render_config(config)

            assert result["my_key"] == "from-file"

    def test_keeps_placeholder_if_unresolved(self, mgr):
        config = {"key": "{{USER_MISSING}}"}
        result = mgr.render_config(config)
        assert result["key"] == "{{USER_MISSING}}"

    def test_non_placeholder_values_pass_through(self, mgr):
        config = {"host": "localhost", "port": 8080}
        result = mgr.render_config(config)
        assert result == {"host": "localhost", "port": 8080}

    def test_mixed_config(self, mgr):
        mgr.set("USER_KNOWN", "resolved")

        config = {
            "known": "{{USER_KNOWN}}",
            "unknown": "{{USER_UNKNOWN}}",
            "plain": "text",
            "number": 42,
        }
        result = mgr.render_config(config)

        assert result["known"] == "resolved"
        assert result["unknown"] == "{{USER_UNKNOWN}}"
        assert result["plain"] == "text"
        assert result["number"] == 42

    def test_does_not_mutate_input(self, mgr):
        mgr.set("USER_KEY", "val")
        config = {"k": "{{USER_KEY}}"}
        original = dict(config)

        mgr.render_config(config)

        assert config == original


# ---------------------------------------------------------------------------
# build_env
# ---------------------------------------------------------------------------


class TestBuildEnv:
    def test_builds_env_from_resolved_config(self, mgr):
        mgr.set("USER_ANTHROPIC_API_KEY", "sk-ant-123")

        config = {"anthropic_api_key": "{{USER_ANTHROPIC_API_KEY}}"}
        env = mgr.build_env(config)

        assert env == {"ANTHROPIC_API_KEY": "sk-ant-123"}

    def test_skips_unresolved_placeholders(self, mgr):
        config = {"missing_key": "{{USER_MISSING}}"}
        env = mgr.build_env(config)

        assert env == {}

    def test_uppercases_keys(self, mgr):
        mgr.set("USER_MY_KEY", "val")

        config = {"my_key": "{{USER_MY_KEY}}"}
        env = mgr.build_env(config)

        assert "MY_KEY" in env

    def test_mixed_resolved_and_unresolved(self, mgr):
        mgr.set("USER_GOOD", "yes")

        config = {
            "good": "{{USER_GOOD}}",
            "bad": "{{USER_BAD}}",
        }
        env = mgr.build_env(config)

        assert env == {"GOOD": "yes"}

    def test_plain_values_included(self, mgr):
        config = {"my_host": "example.com"}
        env = mgr.build_env(config)

        assert env == {"MY_HOST": "example.com"}
