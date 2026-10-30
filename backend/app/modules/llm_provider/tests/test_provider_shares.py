"""2026-10-30-provider-user-share backend 单测（FR-01 / FR-02 / FR-04 / FR-05）。

覆盖：
- 属主按 username/email 共享、重复共享幂等、列表/撤销；
- 拒绝共享给自己 / 未知用户 / 禁用用户（统一 404 防枚举）；
- /usable 语义：own + shared，shared 行 is_shared/shared_by_name 且 is_default=False；
- 被共享方写接口（get/update/delete/set_default/list_shares）仍按属主拒绝；
- 撤销后 usable 立即消失。

夹具镜像 test_llm_provider.py（db_session + 真实 cipher + ORM 直插/Service 创建）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDenied
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import LlmProviderCreate, LlmProviderUpdate
from app.modules.llm_provider.service import (
    LlmProviderNotFound,
    LlmProviderService,
    LlmProviderShareSelfForbidden,
    LlmProviderShareTargetNotFound,
)


async def _create_user(
    session: AsyncSession,
    *,
    label: str = "",
    active: bool = True,
) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"share-{uid.hex[:8]}-{label}@example.com",
            username=f"share-{uid.hex[:8]}-{label}",
            password_hash="irrelevant",
            display_name=f"Share {label}",
            status="active" if active else "disabled",
            login_enabled=active,
        )
    )
    await session.commit()
    return uid


async def _username(session: AsyncSession, uid: uuid.UUID) -> str:
    from app.modules.auth.model import User

    row = await session.get(User, uid)
    assert row is not None and row.username
    return row.username


async def _create_provider(
    session: AsyncSession,
    owner_id: uuid.UUID,
    *,
    name: str = "shared-provider",
    is_default: bool = False,
    api_key: str = "sk-share-secret-123456",
) -> LlmProvider:
    svc = LlmProviderService(session)
    return await svc.create(
        owner_id,
        LlmProviderCreate(
            name=name,
            agent_kinds=["claude"],
            api_key=api_key,
            base_url="https://api.anthropic.com",
            models=[{"name": "claude-sonnet-4", "roles": ["sonnet"]}],
            is_default=is_default,
        ),
    )


@pytest.mark.asyncio
async def test_share_is_idempotent_and_listed(db_session: AsyncSession) -> None:
    """FR-01：按 username 重复共享幂等；列表可见；grantee 显示名回传。"""
    owner = await _create_user(db_session, label="owner")
    grantee = await _create_user(db_session, label="grantee")
    provider = await _create_provider(db_session, owner)
    svc = LlmProviderService(db_session)

    from app.modules.auth.model import User

    grantee_row = await db_session.get(User, grantee)
    assert grantee_row is not None and grantee_row.username

    share1, username1, display1 = await svc.share(provider.id, owner, grantee_row.username)
    share2, username2, display2 = await svc.share(provider.id, owner, grantee_row.username)

    assert share1.id == share2.id
    assert username1 == username2 == grantee_row.username
    assert display1 == display2 == "Share grantee"

    rows = await svc.list_shares(provider.id, owner)
    assert len(rows) == 1
    assert rows[0][0].grantee_user_id == grantee


@pytest.mark.asyncio
async def test_share_accepts_email_identifier(db_session: AsyncSession) -> None:
    """FR-01：email 精确匹配同样可共享。"""
    owner = await _create_user(db_session, label="owner-email")
    grantee = await _create_user(db_session, label="grantee-email")
    provider = await _create_provider(db_session, owner)
    svc = LlmProviderService(db_session)

    from app.modules.auth.model import User

    grantee_row = await db_session.get(User, grantee)
    assert grantee_row is not None and grantee_row.email
    share, username, _ = await svc.share(provider.id, owner, grantee_row.email)
    assert share.grantee_user_id == grantee
    assert username == grantee_row.username


@pytest.mark.asyncio
async def test_share_rejects_self_unknown_and_disabled(db_session: AsyncSession) -> None:
    """FR-01：自己 → 400；未知/禁用 → 404；库中不新增记录。"""
    owner = await _create_user(db_session, label="owner-reject")
    disabled = await _create_user(db_session, label="disabled", active=False)
    provider = await _create_provider(db_session, owner)
    svc = LlmProviderService(db_session)

    from app.modules.auth.model import User

    owner_row = await db_session.get(User, owner)
    disabled_row = await db_session.get(User, disabled)
    assert owner_row is not None and owner_row.username
    assert disabled_row is not None and disabled_row.username

    with pytest.raises(LlmProviderShareSelfForbidden):
        await svc.share(provider.id, owner, owner_row.username)
    with pytest.raises(LlmProviderShareTargetNotFound):
        await svc.share(provider.id, owner, "no-such-user-xyz")
    with pytest.raises(LlmProviderShareTargetNotFound):
        await svc.share(provider.id, owner, disabled_row.username)

    rows = await svc.list_shares(provider.id, owner)
    assert rows == []


@pytest.mark.asyncio
async def test_usable_list_marks_shared_and_clears_default(db_session: AsyncSession) -> None:
    """FR-02：grantee 可用列表含 owner 的共享行（is_shared/shared_by_name/非默认），
    且 shared DTO 不含明文 key；设置页 own-only 列表仍不含共享行。"""
    owner = await _create_user(db_session, label="owner-usable")
    grantee = await _create_user(db_session, label="grantee-usable")
    provider = await _create_provider(db_session, owner, name="owner-default", is_default=True)
    # 属主自由配置里可能藏令牌（评审 P2）：共享 DTO 必须剔除。
    provider.extra_env = {"CUSTOM_TOKEN": "secret-extra"}
    provider.settings_config = {"env": {"SOME_TOKEN": "secret-settings"}}
    await db_session.commit()
    svc = LlmProviderService(db_session)
    await svc.share(provider.id, owner, await _username(db_session, grantee))

    usable = await svc.list_usable(grantee)
    assert len(usable) == 1
    read = svc.to_usable_read(usable[0])
    assert read.id == provider.id
    assert read.is_shared is True
    assert read.shared_by_name == "Share owner-usable"
    assert read.is_default is False
    assert read.api_key_masked is not None
    assert read.extra_env is None
    assert read.settings_config is None
    dumped = str(read.model_dump())
    assert "sk-share-secret" not in dumped
    assert "secret-extra" not in dumped
    assert "secret-settings" not in dumped

    own_only = await svc.list_(grantee)
    assert own_only == []


@pytest.mark.asyncio
async def test_recipient_cannot_mutate_or_query_usage(db_session: AsyncSession) -> None:
    """FR-04：被共享方 get/update/delete/set_default/list_shares 全部按属主拒绝。"""
    owner = await _create_user(db_session, label="owner-ro")
    grantee = await _create_user(db_session, label="grantee-ro")
    provider = await _create_provider(db_session, owner)
    svc = LlmProviderService(db_session)
    await svc.share(provider.id, owner, await _username(db_session, grantee))

    with pytest.raises(PermissionDenied):
        await svc.get(provider.id, grantee)
    with pytest.raises(PermissionDenied):
        await svc.update(provider.id, grantee, LlmProviderUpdate(name="hacked"))
    with pytest.raises(PermissionDenied):
        await svc.delete(provider.id, grantee)
    with pytest.raises(PermissionDenied):
        await svc.set_default(provider.id, grantee)
    with pytest.raises(PermissionDenied):
        await svc.query_usage(provider.id, grantee)
    with pytest.raises(PermissionDenied):
        await svc.list_shares(provider.id, grantee)
    with pytest.raises(PermissionDenied):
        await svc.unshare(provider.id, grantee, owner)

    refreshed = await db_session.get(LlmProvider, provider.id)
    assert refreshed is not None and refreshed.name == "shared-provider"


@pytest.mark.asyncio
async def test_revoked_share_disappears_from_usable_list(db_session: AsyncSession) -> None:
    """FR-05：撤销后 grantee 可用列表立即不再包含该供应商。"""
    owner = await _create_user(db_session, label="owner-revoke")
    grantee = await _create_user(db_session, label="grantee-revoke")
    provider = await _create_provider(db_session, owner)
    svc = LlmProviderService(db_session)

    from app.modules.auth.model import User

    grantee_row = await db_session.get(User, grantee)
    assert grantee_row is not None and grantee_row.username
    await svc.share(provider.id, owner, grantee_row.username)
    assert len(await svc.list_usable(grantee)) == 1

    await svc.unshare(provider.id, owner, grantee)
    assert await svc.list_usable(grantee) == []


@pytest.mark.asyncio
async def test_share_unknown_provider_raises_not_found(db_session: AsyncSession) -> None:
    """FR-01/FR-04：对不存在的 provider 共享/列表 → 404。"""
    owner = await _create_user(db_session, label="owner-missing")
    svc = LlmProviderService(db_session)
    with pytest.raises(LlmProviderNotFound):
        await svc.share(uuid.uuid4(), owner, "whatever")
    with pytest.raises(LlmProviderNotFound):
        await svc.list_shares(uuid.uuid4(), owner)
