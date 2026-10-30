"""2026-10-30-provider-user-share claim 解析单测（FR-03 / FR-05）。

共享守护进程场景：runtime 属主（出借方）≠ 会话属主（选供应商的人）。
``resolve_session_provider_config`` 必须按**会话属主** + 共享授权判定，
而不是 runtime 属主；撤销共享后返回 None 让调用方回落 bound/default 链。

夹具镜像 test_resolve_bound_provider_config.py（db_session + 真实 cipher）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.lease.context import resolve_session_provider_config
from app.modules.llm_provider.model import LlmProvider, LlmProviderShare


async def _create_user(session: AsyncSession, *, label: str = "") -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"pshare-{uid.hex[:8]}-{label}@example.com",
            username=f"pshare-{uid.hex[:8]}-{label}",
            password_hash="irrelevant",
            display_name=f"PShare {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    api_key: str = "sk-pshare-secret-0001",
    model: str = "claude-sonnet-4",
) -> LlmProvider:
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name="pshare",
        agent_kinds=["claude"],
        encrypted_api_key=ct,
        key_id=key_id,
        base_url="https://api.anthropic.com",
        models=[{"name": model, "roles": ["sonnet"]}],
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _create_session(session: AsyncSession, owner_id: uuid.UUID) -> uuid.UUID:
    from app.modules.agent.model import AgentSession

    sid = uuid.uuid4()
    session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
            config={},
            turn_count=1,
            created_at=datetime.now(UTC),
        )
    )
    await session.commit()
    return sid


async def _share(
    session: AsyncSession,
    provider: LlmProvider,
    owner_id: uuid.UUID,
    grantee_id: uuid.UUID,
) -> None:
    session.add(
        LlmProviderShare(
            provider_id=provider.id,
            grantee_user_id=grantee_id,
            shared_by_user_id=owner_id,
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_session_provider_shared_with_session_owner_is_injected(
    db_session: AsyncSession,
) -> None:
    """FR-03：provider 属主 A 共享给会话属主 B（runtime 属主 A）→ B 的会话命中。"""
    host = await _create_user(db_session, label="host")
    borrower = await _create_user(db_session, label="borrower")
    provider = await _seed_provider(db_session, host, api_key="sk-borrower-can-use")
    sid = await _create_session(db_session, borrower)
    await _share(db_session, provider, host, borrower)

    cfg = await resolve_session_provider_config(
        db_session,
        {"session_llm_provider_id": str(provider.id), "session_id": str(sid)},
        "claude",
    )

    assert cfg is not None
    assert cfg["api_key"] == "sk-borrower-can-use"
    assert cfg["model"] == "claude-sonnet-4"


@pytest.mark.asyncio
async def test_session_owner_own_provider_works(db_session: AsyncSession) -> None:
    """FR-03：会话属主自己的供应商（无需共享）照常命中。"""
    borrower = await _create_user(db_session, label="self-owner")
    provider = await _seed_provider(db_session, borrower, api_key="sk-own-provider")
    sid = await _create_session(db_session, borrower)

    cfg = await resolve_session_provider_config(
        db_session,
        {"session_llm_provider_id": str(provider.id), "session_id": str(sid)},
        "claude",
    )

    assert cfg is not None
    assert cfg["api_key"] == "sk-own-provider"


@pytest.mark.asyncio
async def test_session_provider_not_shared_returns_none(db_session: AsyncSession) -> None:
    """FR-03：属主 A 的 provider 未共享给 B → None（回落默认链，不泄露 key）。"""
    host = await _create_user(db_session, label="host-nos")
    borrower = await _create_user(db_session, label="borrower-nos")
    provider = await _seed_provider(db_session, host)
    sid = await _create_session(db_session, borrower)

    cfg = await resolve_session_provider_config(
        db_session,
        {"session_llm_provider_id": str(provider.id), "session_id": str(sid)},
        "claude",
    )
    assert cfg is None


@pytest.mark.asyncio
async def test_revoked_share_falls_back_to_default_chain(
    db_session: AsyncSession,
) -> None:
    """FR-05：撤销共享后同一会话下一轮解析返回 None → 调用方回落默认链。"""
    host = await _create_user(db_session, label="host-rev")
    borrower = await _create_user(db_session, label="borrower-rev")
    provider = await _seed_provider(db_session, host, api_key="sk-revoked-secret")
    sid = await _create_session(db_session, borrower)
    await _share(db_session, provider, host, borrower)
    lease_meta = {
        "session_llm_provider_id": str(provider.id),
        "session_id": str(sid),
    }
    assert (await resolve_session_provider_config(db_session, lease_meta, "claude")) is not None

    from sqlalchemy import delete

    await db_session.execute(
        delete(LlmProviderShare).where(
            LlmProviderShare.provider_id == provider.id,
            LlmProviderShare.grantee_user_id == borrower,
        )
    )
    await db_session.commit()

    cfg = await resolve_session_provider_config(db_session, lease_meta, "claude")
    assert cfg is None
