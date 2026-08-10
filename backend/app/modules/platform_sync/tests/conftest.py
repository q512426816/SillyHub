"""platform_sync 测试 fixture。

自包含建表（不改根 conftest）：``platform_sync`` model 未在根 conftest ``db_engine``
的 import 列表（根 conftest 集中登记各 feature model），本 conftest 用 autouse
fixture 单独建 ``platform_change_progress`` 表，让 platform_sync 测试自包含
（遵守 task-07 allowed_paths，不扩散到根 conftest）。
"""

from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture(autouse=True)
async def ensure_platform_sync_table(db_engine: Any) -> None:
    """建 ``platform_change_progress`` 表。

    platform_sync model 未在根 conftest db_engine import 列表 → metadata 不含该表
    → 根 ``create_all`` 不会建它。此处 import 注册到 metadata + 单独 create 该表。
    """
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[_ps_model.PlatformChangeProgressORM.__table__],
        )


@pytest.fixture()
async def apikey_headers(db_session: Any) -> dict[str, str]:
    """造测试 User + 签发 ``shk_live_`` API Key，返回 Bearer headers（测 APIKey 鉴权路径）。

    用 ``ApiKeyService.create`` 正规路径（不绕过 bcrypt），plaintext 即 ``shk_live_…``
    作为 ``Authorization: Bearer`` —— 验证 require_platform_sync 的 APIKey 分支。
    """
    from app.core.config import get_settings
    from app.modules.auth.api_key_service import ApiKeyService
    from app.modules.auth.model import User

    user = User(
        email="sync-user@example.com",
        password_hash="x",  # API Key 鉴权不走密码，占位即可
        display_name="SyncUser",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    _row, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
        user_id=user.id,
        name="platform-sync-test",
        expires_at=None,
    )
    return {"Authorization": f"Bearer {plaintext}"}
