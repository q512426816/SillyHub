"""task-04 / FR-05 / D-002@v1: bootstrap 管理员弱口令 field_validator 单测。

钉死 config 加载期 fail-fast 行为：常见弱口令、与登录名相同的口令 → ``Settings``
实例化抛 :class:`pydantic.ValidationError`；强口令与未配置（``None``，D-004：bootstrap
可选）正常放行。纯 ``Settings`` 实例化校验，不依赖真实 DB。
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.core.config import _WEAK_BOOTSTRAP_PASSWORDS, Settings

# Settings 必填项（database_url / secret_key min_length=16）；与被测字段无关，给合法占位。
_REQUIRED: dict[str, str] = {
    "database_url": "postgresql+asyncpg://u:p@localhost:5432/db",
    "secret_key": "x" * 32,
}


def _make(password: str | None, email: str | None = None) -> Settings:
    kwargs = {**_REQUIRED, "platform_bootstrap_admin_password": password}
    if email is not None:
        kwargs["platform_bootstrap_admin_email"] = email
    return Settings(**kwargs)


@pytest.mark.parametrize("weak", sorted(_WEAK_BOOTSTRAP_PASSWORDS))
def test_weak_passwords_rejected(weak: str) -> None:
    """弱口令表逐项：实例化必抛 ValidationError（FR-05 / D-002@v1 fail-fast）。"""
    with pytest.raises(ValidationError):
        _make(weak)


def test_password_equal_to_email_local_part_rejected() -> None:
    """口令与登录名（email 本地部分）相同被拒。"""
    with pytest.raises(ValidationError):
        _make("bootstrap", email="bootstrap@sillyhub.local")


def test_strong_passwords_accepted() -> None:
    """强口令（非弱表、非登录名）正常构造。"""
    for strong in ("Xx1!abcd", "Admin123!@#", "SillyHub#Boot2026!xK9"):
        settings = _make(strong, email="admin@sillyhub.local")
        assert settings.platform_bootstrap_admin_password == strong


def test_none_password_accepted() -> None:
    """未配 bootstrap（None）放行——D-004：bootstrap 可选，缺失=不建号。"""
    settings = _make(None)
    assert settings.platform_bootstrap_admin_password is None


def test_none_password_with_email_accepted() -> None:
    """只配 email、未配 password 也放行（None 优先于跨字段登录名检查）。"""
    settings = _make(None, email="admin@sillyhub.local")
    assert settings.platform_bootstrap_admin_password is None
