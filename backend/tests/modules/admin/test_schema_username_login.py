"""task-02 schema 层单测：username 必填 / email Optional / re-export 同步。

覆盖 change ``2026-06-24-username-login`` task-02 §9/§10 AC-07/AC-08
（verify 登记的 test debt，归档前补齐）：
- AC-07: auth.schema.UserRead email=None 可空（model_validate 不报错 + JSON null）。
- AC-08: settings.schema re-export 的 UserCreateRequest 与 admin.schema 同一对象（is），
         且字段已同步（username 必填 min_length=3 / email Optional）。
纯 Pydantic + import 单测，无需 DB/HTTP fixture。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.modules.admin.schema import UserCreateRequest
from app.modules.auth.schema import UserRead


def test_auth_user_read_email_optional() -> None:
    """AC-07: auth.schema.UserRead 馈入 email=None 对象 → 不报错、.email is None、JSON null。"""
    obj = SimpleNamespace(
        id=uuid.uuid4(),
        email=None,
        username="alice",
        display_name=None,
        status="active",
        is_platform_admin=False,
        last_login_at=None,
        created_at=datetime(2026, 1, 1, 0, 0, 0),
    )
    read = UserRead.model_validate(obj)
    assert read.email is None
    assert '"email":null' in read.model_dump_json()


def test_settings_reexport_synced() -> None:
    """AC-08: settings.schema re-export 的 UserCreateRequest 与 admin.schema 同一对象，
    且字段同步（username 必填 min_length=3 / email Optional）。"""
    from app.modules.settings.schema import UserCreateRequest as Reexported

    # re-export 同一对象：改 admin.schema 自动同步到 settings.schema（Python import 机制）
    assert Reexported is UserCreateRequest

    # email Optional：不传 email 成功，.email is None
    created = UserCreateRequest(username="alice", password="longpass1")
    assert created.email is None
    assert created.username == "alice"

    # username 必填：缺 username → ValidationError
    with pytest.raises(ValidationError):
        UserCreateRequest(password="longpass1")  # type: ignore[call-arg]

    # username min_length=3：太短 → ValidationError
    with pytest.raises(ValidationError):
        UserCreateRequest(username="ab", password="longpass1")
