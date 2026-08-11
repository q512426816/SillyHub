"""task-09（change 2026-08-11-agent-profile-bind-llm-provider）``resolve_bound_provider_config`` 单测。

方案A：档案绑定 LlmProvider 后，claim 装配优先用绑定 provider 的凭证（仅 daemon
登记者本人绑定生效 + agent_kind 一致）。覆盖 acceptance 七场景：
  1. 绑定命中（归属 + agent_kind 通过）→ 9 字段 anthropic config，api_key 解密明文；
  2. 绑定 provider 不要求 is_default=True（区别于 resolve_default）；
  3. 未绑定（无 key / None）→ None（回退用户默认 D-005）；
  4. llm_provider_id 格式无效 → None；
  5. 归属不符（provider 属于别人）→ None（方案A 不泄露，D-006）；
  6. agent_kind 不符（codex 引擎绑 claude provider）→ None（FR-006 堵直写绕过）；
  7. 绑定 provider 不存在（被删）→ None（ondelete SET NULL 回退）；
  8. openai_chat 形态绑定 → 6 字段 config（不含上游 key）。

夹具范式镜像 ``test_resolve_default_provider_config.py``（``db_session`` +
``_create_user`` + ``_seed_provider``，真实 cipher 加密落盘）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.lease.context import resolve_bound_provider_config
from app.modules.llm_provider.model import LlmProvider


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession, *, label: str = "") -> uuid.UUID:
    """插入 User 行（与 test_resolve_default_provider_config.py 同款）。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task09-rbpc-{uid.hex[:8]}-{label}@example.com",
            username=f"task09-rbpc-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"Task09 RBPC {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_kind: str = "claude",
    is_default: bool = False,
    api_key: str = "sk-bound-seed-xxxxxxxx",
    name: str = "bound",
    base_url: str = "https://api.anthropic.com",
    model: str | None = "claude-sonnet-4",
    api_format: str = "anthropic",
) -> LlmProvider:
    """直插 ORM 行（绕过 schema Literal['claude']），真实 cipher 加密落盘。"""
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kind=agent_kind,
        encrypted_api_key=ct,
        key_id=key_id,
        base_url=base_url,
        model=model,
        is_default=is_default,
        api_format=api_format,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ════════════════════════════════════════════════════════════════════════════
# 1-2. 绑定命中 → 用绑定 provider 的 config
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigFound:
    """归属 + agent_kind 双通过 → 用绑定 provider 的 config。"""

    @pytest.mark.asyncio
    async def test_bound_returns_anthropic_config(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="found")
        provider = await _seed_provider(db_session, user_id, api_key="sk-bound-anthropic-0001")

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(provider.id)}, user_id, "claude"
        )

        assert cfg is not None
        assert cfg["agent_kind"] == "claude"
        assert cfg["api_key"] == "sk-bound-anthropic-0001"
        assert cfg["model"] == "claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_bound_ignores_is_default_flag(self, db_session: AsyncSession) -> None:
        """绑定 provider 不要求 is_default=True（区别于 resolve_default 查 is_default=True）。"""
        user_id = await _create_user(db_session, label="nodefault-bound")
        provider = await _seed_provider(
            db_session, user_id, is_default=False, api_key="sk-notdefault-bound-0022"
        )

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(provider.id)}, user_id, "claude"
        )

        assert cfg is not None
        assert cfg["api_key"] == "sk-notdefault-bound-0022"


# ════════════════════════════════════════════════════════════════════════════
# 3-4. 未绑定 / 格式无效 → None（回退默认）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigNotBound:
    """未绑定 → None（调用方回退用户默认 D-005）。"""

    @pytest.mark.asyncio
    async def test_no_key_returns_none(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="nokey")

        cfg = await resolve_bound_provider_config(db_session, {}, user_id, "claude")

        assert cfg is None

    @pytest.mark.asyncio
    async def test_none_value_returns_none(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="noneval")

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": None}, user_id, "claude"
        )

        assert cfg is None

    @pytest.mark.asyncio
    async def test_invalid_uuid_returns_none(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="baduuid")

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": "not-a-uuid"}, user_id, "claude"
        )

        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 5. 归属不符 → None（方案A 不泄露，D-006）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigOwnership:
    """provider 属于别人 → None（不泄露他人凭证）。"""

    @pytest.mark.asyncio
    async def test_other_user_provider_returns_none(self, db_session: AsyncSession) -> None:
        user_a = await _create_user(db_session, label="ownerA")
        user_b = await _create_user(db_session, label="ownerB")
        provider_a = await _seed_provider(db_session, user_a, api_key="sk-a-secret-never-leak")

        # B 的 lease 绑了 A 的 provider → B 拿不到（归属不符）。
        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(provider_a.id)}, user_b, "claude"
        )

        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 6. agent_kind 不符 → None（FR-006 堵直写绕过）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigAgentKindMismatch:
    """codex 引擎档案绑了 claude provider → None（防错配凭证下发）。"""

    @pytest.mark.asyncio
    async def test_agent_kind_mismatch_returns_none(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="akmismatch")
        provider = await _seed_provider(
            db_session, user_id, agent_kind="claude", api_key="sk-claude-only"
        )

        # lease 归一化 agent_kind=codex，绑的是 claude provider → 不符。
        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(provider.id)}, user_id, "codex"
        )

        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 7. 绑定 provider 不存在（被删）→ None
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigDeleted:
    """provider 被删（ondelete SET NULL 后 id 残留或指向不存在行）→ None（回退默认）。"""

    @pytest.mark.asyncio
    async def test_provider_not_found_returns_none(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="deleted")
        random_id = uuid.uuid4()

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(random_id)}, user_id, "claude"
        )

        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 8. openai_chat 形态绑定 → 6 字段 config（不含上游 key）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveBoundProviderConfigOpenai:
    """openai_chat 形态绑定 → 6 字段 config（D-003/NFR-01 不下发上游 key）。"""

    @pytest.mark.asyncio
    async def test_openai_bound_returns_6_field_config(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="openai-bound")
        provider = await _seed_provider(
            db_session,
            user_id,
            api_format="openai_chat",
            api_key="sk-openai-upstream-never-sent",
            model="zen-1",
        )

        cfg = await resolve_bound_provider_config(
            db_session, {"llm_provider_id": str(provider.id)}, user_id, "claude"
        )

        assert cfg is not None
        assert cfg["api_format"] == "openai_chat"
        assert cfg["model"] == "zen-1"
        # D-003/NFR-01：上游 api_key 绝不下发。
        assert "api_key" not in cfg
        # litellm_model_name 用 provider.user_id（design §4.3），与 task-09 单一真相源一致。
        from app.modules.llm_provider.litellm_client import litellm_model_name

        assert cfg["litellm_model_name"] == litellm_model_name(user_id, provider.id)
