"""platform_sync 测试 fixture。

自包含建表（不改根 conftest）：``platform_sync`` model 未在根 conftest ``db_engine``
的 import 列表（根 conftest 集中登记各 feature model），本 conftest 用 autouse
fixture 单独建 ``platform_change_progress`` + ``platform_sync_tokens`` 表，让
platform_sync 测试自包含（遵守 task-07 allowed_paths，不扩散到根 conftest）。
"""

from __future__ import annotations

from typing import Any

import pytest


@pytest.fixture(autouse=True)
async def ensure_platform_sync_table(db_engine: Any) -> None:
    """建 ``platform_change_progress`` + ``platform_sync_tokens`` 表。

    platform_sync model 未在根 conftest db_engine import 列表 → metadata 不含该表
    → 根 ``create_all`` 不会建它。此处 import 注册到 metadata + 单独 create 两张表
    （task-01 加 platform_sync_tokens，task-02 给 progress 表加 workspace_id 复合 PK）。
    """
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model
    from app.modules.platform_sync import token_model as _ps_token_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[
                _ps_model.PlatformChangeProgressORM.__table__,
                _ps_token_model.PlatformSyncTokenORM.__table__,
            ],
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


@pytest.fixture()
async def shpsync_headers(db_session: Any) -> tuple[Any, dict[str, str]]:
    """建 workspace + User + 签发 ``shpsync_`` token，返回 ``(workspace_id, Bearer headers)``。

    task-06（security-audit-remediation，D-004@v1）：三个写端点收紧为仅 shpsync_ 可写
    （JWT/shk_live_ 一律 403），原 ``apikey_headers`` 写路径回归用例迁移到本 fixture
    （tasks 卡预判）。返回 workspace_id 供需要断言 workspace 归属的用例复用。
    """
    import uuid as _uuid

    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=_uuid.uuid4(),
        name=f"ws-sync-{_uuid.uuid4().hex[:8]}",
        slug=f"ws-sync-{_uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-sync-{_uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    user = User(
        id=_uuid.uuid4(),
        email=f"sync-{_uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(ws)

    _row, plaintext = await PlatformSyncTokenService(db_session, settings=get_settings()).create(
        workspace_id=ws.id,
        name="sync-regression",
        created_by=user.id,
    )
    return ws.id, {"Authorization": f"Bearer {plaintext}"}
