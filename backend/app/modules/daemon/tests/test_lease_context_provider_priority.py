"""task-04（change 2026-08-14-sessions-portal）``_inject_provider_config`` 供应商优先级单测。

覆盖 design §5 Wave1 第 3 点 + FR-04 + R-02 + D-013@v1 蓝图验收矩阵：
  1. 会话供应商 > 全局默认：metadata 有 ``session_llm_provider_id`` 时 provider_config
     来源于该供应商（即使用户另有 is_default=True 的默认供应商 / lease 另有档案绑定）；
  2. 未传走原链——bound 分支（现状不变）：metadata 只有 ``llm_provider_id`` → 档案绑定
     provider 生效；
  3. 未传走原链——default 分支（现状不变）：无任何绑定 key → 用户默认 provider 生效；
  4. 会话供应商 id 不存在 / 属主不符 / 引擎不符 → 静默降级走原链（不抛错）；
  5. 会话分支解析抛异常 → try/except 降级走原链（不阻断会话创建，留日志）。

metadata key 纪律（R-02）：会话级用独立 key ``session_llm_provider_id``，与档案绑定
``llm_provider_id`` 严格区分——两 key 同时存在时会话级压制档案绑定（FR-04「压制」语义）。

夹具范式镜像 ``test_lease_context.py``：import ``test_lease_service.py`` 的
``_create_user`` / ``_create_runtime`` / ``_create_interactive_lease`` helper，
provider 落盘镜像 ``test_resolve_bound_provider_config.py`` 的 ``_seed_provider``
（真实 cipher 加密）。直测 ``_inject_provider_config``（不 mock 被测方法自身）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.lease.context import _inject_provider_config
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_interactive_lease,
    _create_runtime,
    _create_user,
)
from app.modules.llm_provider.model import LlmProvider

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    api_key: str,
    is_default: bool = False,
    model: str | None = "claude-sonnet-4",
    base_url: str = "https://api.anthropic.com",
    agent_kind: str = "claude",
    name: str = "provider",
) -> LlmProvider:
    """直插 LlmProvider 行（真实 cipher 加密落盘）。

    镜像 ``test_resolve_bound_provider_config.py::_seed_provider``。
    """
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"t04-{name}-{uuid.uuid4().hex[:6]}",
        agent_kind=agent_kind,
        encrypted_api_key=ct,
        key_id=key_id,
        base_url=base_url,
        model=model,
        is_default=is_default,
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _make_interactive_lease(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    lease_meta: dict,
) -> DaemonTaskLease:
    """interactive lease（runtime_id → DaemonRuntime.user_id 主路径供 user_id 解析）。"""
    rt = await _create_runtime(session, user_id)
    meta = {"session_id": str(uuid.uuid4()), "provider": "claude_code", **lease_meta}
    return await _create_interactive_lease(session, rt.id, metadata=meta)


# ════════════════════════════════════════════════════════════════════════════
# 1. 会话供应商 > 全局默认（最高优先级）
# ════════════════════════════════════════════════════════════════════════════


class TestSessionProviderHighestPriority:
    """metadata 有 session_llm_provider_id → provider_config 来源于该供应商。"""

    @pytest.mark.asyncio
    async def test_session_provider_overrides_default(self, db_session: AsyncSession) -> None:
        """用户另有 is_default=True 默认供应商，会话选了另一家 → 用会话选的。"""
        # Arrange：默认供应商 + 会话选择供应商，两家字段可区分。
        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-default-key",
            is_default=True,
            base_url="https://default.example.com",
            model="default-model",
        )
        session_provider = await _seed_provider(
            db_session,
            user_id,
            api_key="sk-session-key",
            base_url="https://session.example.com",
            model="session-model",
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"session_llm_provider_id": str(session_provider.id)},
        )
        payload: dict = {"model": "lease-meta-model"}

        # Act
        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        # Assert：provider_config 逐字段来自会话供应商，非默认供应商。
        cfg = payload["provider_config"]
        assert cfg["api_key"] == "sk-session-key"
        assert cfg["base_url"] == "https://session.example.com"
        assert cfg["model"] == "session-model"
        assert cfg["agent_kind"] == "claude"
        # X-10 同款 model 覆盖：会话供应商 model 覆盖 payload[model]。
        assert payload["model"] == "session-model"

    @pytest.mark.asyncio
    async def test_session_provider_overrides_bound_profile_provider(
        self, db_session: AsyncSession
    ) -> None:
        """两 key 并存（session_llm_provider_id + llm_provider_id）→ 会话级压制档案绑定。

        R-02/FR-04「压制」语义：不同 key 天然不冲突，会话级优先。
        """
        user_id = await _create_user(db_session)
        bound_provider = await _seed_provider(
            db_session,
            user_id,
            api_key="sk-bound-key",
            name="bound",
        )
        session_provider = await _seed_provider(
            db_session,
            user_id,
            api_key="sk-session-key-2",
            name="session",
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={
                "session_llm_provider_id": str(session_provider.id),
                "llm_provider_id": str(bound_provider.id),
            },
        )
        payload: dict = {}

        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        cfg = payload["provider_config"]
        assert cfg["api_key"] == "sk-session-key-2"
        assert cfg["api_key"] != "sk-bound-key"


# ════════════════════════════════════════════════════════════════════════════
# 2-3. 未传走原链（现状不变，零回归）
# ════════════════════════════════════════════════════════════════════════════


class TestNoSessionKeyFallsBackToOriginalChain:
    """无 session_llm_provider_id → 注入结果与现状逐字段一致（零回归）。"""

    @pytest.mark.asyncio
    async def test_without_session_key_bound_branch_unchanged(
        self, db_session: AsyncSession
    ) -> None:
        """原链 bound 分支：只有 llm_provider_id（档案绑定）→ 用绑定 provider。"""
        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-default-never-hit",
            is_default=True,
        )
        bound_provider = await _seed_provider(
            db_session,
            user_id,
            api_key="sk-bound-only",
            base_url="https://bound.example.com",
            model="bound-model",
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"llm_provider_id": str(bound_provider.id)},
        )
        payload: dict = {}

        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        cfg = payload["provider_config"]
        assert cfg["api_key"] == "sk-bound-only"
        assert cfg["base_url"] == "https://bound.example.com"
        assert cfg["model"] == "bound-model"
        assert payload["model"] == "bound-model"

    @pytest.mark.asyncio
    async def test_without_session_key_default_branch_unchanged(
        self, db_session: AsyncSession
    ) -> None:
        """原链 default 分支：无任何绑定 key → 用户默认 provider。"""
        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-plain-default",
            is_default=True,
            base_url="https://plain-default.example.com",
            model="plain-default-model",
        )
        lease = await _make_interactive_lease(db_session, user_id, lease_meta={})
        payload: dict = {}

        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        cfg = payload["provider_config"]
        assert cfg["api_key"] == "sk-plain-default"
        assert cfg["base_url"] == "https://plain-default.example.com"
        assert cfg["model"] == "plain-default-model"


# ════════════════════════════════════════════════════════════════════════════
# 4. 会话供应商 id 不存在 / 属主不符 / 引擎不符 → 降级走原链
# ════════════════════════════════════════════════════════════════════════════


class TestSessionProviderDegradesToOriginalChain:
    """会话供应商解析不命中 → 静默降级走原链（不抛错、不阻断会话创建）。"""

    @pytest.mark.asyncio
    async def test_nonexistent_session_provider_id_falls_back_to_default(
        self, db_session: AsyncSession
    ) -> None:
        """id 指向不存在的 provider（已被删）→ 回退用户默认。"""
        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-fallback-default",
            is_default=True,
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"session_llm_provider_id": str(uuid.uuid4())},
        )
        payload: dict = {}

        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        assert payload["provider_config"]["api_key"] == "sk-fallback-default"

    @pytest.mark.asyncio
    async def test_other_user_session_provider_falls_back_to_default(
        self, db_session: AsyncSession
    ) -> None:
        """会话供应商属于他人（属主不符）→ 回退用户默认，不泄露他人凭证。"""
        user_id = await _create_user(db_session)
        other_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-own-default",
            is_default=True,
        )
        foreign = await _seed_provider(
            db_session,
            other_id,
            api_key="sk-foreign-never-leak",
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"session_llm_provider_id": str(foreign.id)},
        )
        payload: dict = {}

        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        cfg = payload["provider_config"]
        assert cfg["api_key"] == "sk-own-default"
        assert cfg["api_key"] != "sk-foreign-never-leak"

    @pytest.mark.asyncio
    async def test_agent_kind_mismatch_session_provider_falls_back(
        self, db_session: AsyncSession
    ) -> None:
        """会话供应商 agent_kind 与引擎不符 → 回退（FR-006 同款防错配）。"""
        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-kind-default",
            is_default=True,
        )
        mismatched = await _seed_provider(
            db_session,
            user_id,
            api_key="sk-codex-provider",
            agent_kind="codex",
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"session_llm_provider_id": str(mismatched.id)},
        )
        payload: dict = {}

        # agent_kind_raw='claude_code' 归一化为 'claude'，供应商是 codex → 不符。
        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        assert payload["provider_config"]["api_key"] == "sk-kind-default"

    @pytest.mark.asyncio
    async def test_resolution_exception_falls_back_without_raising(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """会话分支解析抛异常（如 DB 抖动）→ try/except 降级走原链，不阻断会话创建。

        mock 只让**首次**调用（即会话级分支）抛错，后续调用透传真实实现——原链
        bound 分支同样调 ``resolve_bound_provider_config``，不能一并炸掉。被测方法
        ``_inject_provider_config`` 本身不 mock。降级后原链命中用户默认。
        """
        from app.modules.daemon.lease import context as ctx_module

        real_resolve = ctx_module.resolve_bound_provider_config
        calls = {"n": 0}

        async def _raise_first_then_real(*args, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                raise RuntimeError("simulated session-provider resolution failure")
            return await real_resolve(*args, **kwargs)

        monkeypatch.setattr(ctx_module, "resolve_bound_provider_config", _raise_first_then_real)

        user_id = await _create_user(db_session)
        await _seed_provider(
            db_session,
            user_id,
            api_key="sk-after-exception",
            is_default=True,
        )
        lease = await _make_interactive_lease(
            db_session,
            user_id,
            lease_meta={"session_llm_provider_id": str(uuid.uuid4())},
        )
        payload: dict = {}

        # Act：不抛错（降级），注入走原链默认。
        await _inject_provider_config(
            db_session, lease, dict(lease.metadata_), payload, agent_kind_raw="claude_code"
        )

        assert payload["provider_config"]["api_key"] == "sk-after-exception"
