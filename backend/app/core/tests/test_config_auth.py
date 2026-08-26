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


class TestResolvedCommitShaCache:
    """ql-20260826-011：git 探测结果进程内缓存（/health 高频轮询防反复 spawn git）。"""

    def test_probe_runs_once_and_caches(self, monkeypatch):
        """commit_sha 未显式配置时，首次 access 探测 git，后续 access 命中缓存。"""
        from unittest.mock import patch

        s = Settings(**_base_kwargs())
        assert s.commit_sha in (None, "") or isinstance(s.commit_sha, str)

        with patch(
            "app.core.config.subprocess.check_output", return_value=b"abc123def456"
        ) as probe:
            first = s.resolved_commit_sha
            second = s.resolved_commit_sha
            third = s.resolved_commit_sha

        assert probe.call_count == 1, "git 子进程只应被 spawn 一次"
        assert first == second == third == "abc123def456"

    def test_probe_failure_caches_unknown(self, monkeypatch):
        """git 探测失败回退 unknown 并缓存，不再反复重试。"""
        from unittest.mock import patch

        s = Settings(**_base_kwargs())
        with patch(
            "app.core.config.subprocess.check_output", side_effect=OSError("no git")
        ) as probe:
            assert s.resolved_commit_sha == "unknown"
            assert s.resolved_commit_sha == "unknown"
        assert probe.call_count == 1

    def test_explicit_commit_sha_skips_probe(self, monkeypatch):
        """显式配置 commit_sha 时永不探测（Docker build-arg 注入路径）。"""
        from unittest.mock import patch

        s = Settings(**_base_kwargs(commit_sha="deadbeefcafe"))
        with patch(
            "app.core.config.subprocess.check_output", side_effect=AssertionError("不应探测")
        ):
            assert s.resolved_commit_sha == "deadbeefcafe"
