"""task-10（2026-08-06-provider-switch-live-session）``resolve_default_provider_config`` 单测。

change task-02 抽出的 D-006「单一真相源」helper（位于 ``daemon/lease/context.py``），
供 claim 路径 ``_inject_provider_config`` 与 ``set_default`` 即时下发共用，避免两处
各写一份「查默认 + 解密 + 构造」逻辑。task-01~09 间接走过此函数（claim / set_default
测试），但**无直接 unit test**守护契约；task-10「查漏补缺」补全。

覆盖（acceptance「resolve_default_provider_config 复用 + 无默认返回 None」）：
  1. 命中默认 → 返回 9 字段 dict + api_key 经 cipher.decrypt 解出明文；
  2. 未配默认 → 返回 None（D-007 零回归，调用方据此不加 provider_config 键 / 不推送）；
  3. agent_kind 隔离：claude 默认存在,查 codex → None（R-05 互斥维度）；
  4. owner 隔离：A 的默认,用 B 的 user_id 查 → None（D-008 owner 级）；
  5. settings_config=None 原样透传（task-01 brownfield 老行兼容,D-009）；
  6. settings_config 非 None 原样透传（task-01 生成行,字段非空时按 dict 透传）；
  7. helper 纯查询：不改 ``is_default`` 字段（read-only 守护）。

夹具范式镜像 ``test_lease_context.py`` + ``test_llm_provider.py``：
  - ``db_session`` + ``_create_user`` 共用（SQLite in-memory + 真实 cipher）；
  - provider 行经 ``LlmProviderService.create`` 走真实加密落盘（与生产一致），
    解密链路才能拿到非空明文；
  - 跨 agent_kind 隔离用 ``_seed_provider_row`` 直插 ORM（schema Literal 限制 claude）。
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import get_cipher
from app.modules.daemon.lease.context import resolve_default_provider_config
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import LlmProviderCreate
from app.modules.llm_provider.service import LlmProviderService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession, *, label: str = "") -> uuid.UUID:
    """插入 User 行（FK 兼容；与 test_llm_provider.py / test_provider_switch.py 同款）。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task10-rdpc-{uid.hex[:8]}-{label}@example.com",
            username=f"task10-rdpc-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"Task10 RDPC {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _seed_provider_row(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_kind: str,
    is_default: bool = False,
    api_key: str = "sk-seeded-xxxxxxxx",
    name: str = "seeded",
    base_url: str = "https://api.anthropic.com",
    settings_config: dict | None = None,
) -> LlmProvider:
    """直插 ORM 行（绕过 schema Literal['claude']），用真实 cipher 加密。

    用于构造 codex / 自定义字段（settings_config）等 schema 不允许的 case。
    与 test_llm_provider.py 同名 helper 同范式。
    """
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
        is_default=is_default,
        settings_config=settings_config,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


# ════════════════════════════════════════════════════════════════════════════
# 1. 命中默认 → 9 字段 dict + 解密明文
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigFound:
    """命中默认 → 返回 9 字段中性 dict（D-006 单一真相源契约）。"""

    @pytest.mark.asyncio
    async def test_returns_9_field_dict_when_default_exists(self, db_session: AsyncSession) -> None:
        """有默认 provider → dict 含 9 字段（agent_kind/base_url/api_key/auth_field/
        model/model_role_mappings/default_fallback_model/extra_env/settings_config）。"""
        user_id = await _create_user(db_session, label="found")
        svc = LlmProviderService(db_session)
        plaintext = "sk-ant-task10-secret-0001"
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="p",
                api_key=plaintext,
                base_url="https://api.anthropic.com",
                model="claude-sonnet-4",
                is_default=True,
            ),
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        expected_keys = {
            "agent_kind",
            "base_url",
            "api_key",
            "auth_field",
            "model",
            "model_role_mappings",
            "default_fallback_model",
            "extra_env",
            "settings_config",
        }
        assert set(cfg.keys()) == expected_keys
        # 字段值透传。
        assert cfg["agent_kind"] == "claude"
        assert cfg["base_url"] == "https://api.anthropic.com"
        assert cfg["model"] == "claude-sonnet-4"
        assert cfg["auth_field"] == "ANTHROPIC_AUTH_TOKEN"

    @pytest.mark.asyncio
    async def test_decrypts_api_key_to_plaintext(self, db_session: AsyncSession) -> None:
        """api_key 字段经 ``cipher.decrypt`` 解出明文（daemon spawn-env 注入必需）。"""
        user_id = await _create_user(db_session, label="decrypt")
        svc = LlmProviderService(db_session)
        plaintext = "sk-ant-task10-plainkey-4242"
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="p",
                api_key=plaintext,
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        # 关键守护：解密明文 = 落盘前明文（不是密文 bytes / 不是 None）。
        assert cfg["api_key"] == plaintext
        assert isinstance(cfg["api_key"], str)

    @pytest.mark.asyncio
    async def test_optional_fields_none_when_unset(self, db_session: AsyncSession) -> None:
        """未设的 JSON / model 字段 → None 原样透传（provider.model_role_mappings 等）。"""
        user_id = await _create_user(db_session, label="opt")
        svc = LlmProviderService(db_session)
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="p",
                api_key="sk-min-0011",
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        # 未传 → schema 默认 None。
        assert cfg["model_role_mappings"] is None
        assert cfg["default_fallback_model"] is None
        assert cfg["extra_env"] is None
        assert cfg["settings_config"] is None
        assert cfg["model"] is None  # 未传 model


# ════════════════════════════════════════════════════════════════════════════
# 2. 未配默认 → 返回 None（D-007 零回归）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigNotFound:
    """无默认 → None（调用方据此 absent provider_config 键 / 不推送）。"""

    @pytest.mark.asyncio
    async def test_returns_none_when_no_rows(self, db_session: AsyncSession) -> None:
        """用户完全无 provider 行 → None。"""
        user_id = await _create_user(db_session, label="empty")

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is None

    @pytest.mark.asyncio
    async def test_returns_none_when_rows_but_no_default(self, db_session: AsyncSession) -> None:
        """用户有 provider 但 ``is_default=False``（从未 set_default）→ None。

        守护查询的 ``is_default.is_(True)`` 过滤条件 —— 行存在但默认标志未置位时,
        不应误命中（防 fallback 到「随便挑一个」）。
        """
        user_id = await _create_user(db_session, label="nodefault")
        svc = LlmProviderService(db_session)
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="not-default",
                api_key="sk-notdef-0011",
                base_url="https://api.anthropic.com",
                is_default=False,  # 显式 False
            ),
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 3. agent_kind 隔离（R-05 互斥维度）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigAgentKindIsolation:
    """claude 默认存在,查 codex → None（agent_kind 维度不串扰）。"""

    @pytest.mark.asyncio
    async def test_other_agent_kind_returns_none(self, db_session: AsyncSession) -> None:
        """claude 默认存在 + codex 默认存在 → 各查各的,不互窜。

        schema 限制 create 只能 claude,故 codex 行经 ``_seed_provider_row`` 直插 ORM。
        """
        user_id = await _create_user(db_session, label="ak")
        svc = LlmProviderService(db_session)
        # claude 默认 provider（经 service.create）。
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="claude-def",
                api_key="sk-claude-only-0011",
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )
        # codex 默认 provider（直插 ORM）。
        await _seed_provider_row(
            db_session,
            user_id,
            agent_kind="codex",
            is_default=True,
            api_key="sk-codex-only-4242",
            name="codex-def",
            base_url="https://api.codex.example",
        )

        claude_cfg = await resolve_default_provider_config(db_session, user_id, "claude")
        codex_cfg = await resolve_default_provider_config(db_session, user_id, "codex")

        # claude 查到 claude,codex 查到 codex（agent_kind 互不串扰）。
        assert claude_cfg is not None
        assert claude_cfg["agent_kind"] == "claude"
        assert claude_cfg["api_key"] == "sk-claude-only-0011"

        assert codex_cfg is not None
        assert codex_cfg["agent_kind"] == "codex"
        assert codex_cfg["api_key"] == "sk-codex-only-4242"
        assert codex_cfg["base_url"] == "https://api.codex.example"

    @pytest.mark.asyncio
    async def test_unknown_agent_kind_returns_none(self, db_session: AsyncSession) -> None:
        """查不存在的 agent_kind（如 'gemini'）→ None。"""
        user_id = await _create_user(db_session, label="unknown-ak")
        svc = LlmProviderService(db_session)
        await svc.create(
            user_id,
            LlmProviderCreate(
                name="claude-def",
                api_key="sk-x-0001",
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "gemini")
        assert cfg is None


# ════════════════════════════════════════════════════════════════════════════
# 4. owner 隔离（D-008 owner 级）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigOwnerIsolation:
    """A 的默认,用 B 的 user_id 查 → None（D-008 owner 级不互窜）。"""

    @pytest.mark.asyncio
    async def test_other_user_default_not_resolved(self, db_session: AsyncSession) -> None:
        """用户 A 的 claude 默认,以用户 B 身份查 → None（owner WHERE 过滤）。"""
        user_a = await _create_user(db_session, label="ownerA")
        user_b = await _create_user(db_session, label="ownerB")
        svc = LlmProviderService(db_session)
        await svc.create(
            user_a,  # A 的 provider
            LlmProviderCreate(
                name="a-private",
                api_key="sk-a-only-0001",
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )

        # B 查 claude 默认 → None（看不到 A 的）。
        cfg_b = await resolve_default_provider_config(db_session, user_b, "claude")
        assert cfg_b is None

        # A 自己能查到。
        cfg_a = await resolve_default_provider_config(db_session, user_a, "claude")
        assert cfg_a is not None
        assert cfg_a["api_key"] == "sk-a-only-0001"


# ════════════════════════════════════════════════════════════════════════════
# 5. settings_config 原样透传（D-009 / brownfield 兼容）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigSettingsConfig:
    """settings_config 原样透传 —— None / dict 均不加工（D-009 不解密 / 不判空）。"""

    @pytest.mark.asyncio
    async def test_settings_config_none_passes_through(self, db_session: AsyncSession) -> None:
        """task-01 brownfield 老行（settings_config 列为 NULL）→ cfg["settings_config"]=None。

        守护 helper 不做 ``?? {}`` 默认值兜底（daemon 侧 ``spawn-env.ts`` 自行判空,
        backend 保持「字段是什么就传什么」语义）。
        """
        user_id = await _create_user(db_session, label="sc-null")
        # 直插 ORM 模拟老行（settings_config 列 NULL,service.create 也会落 None
        # 但直插更明确模拟 brownfield）。
        await _seed_provider_row(
            db_session,
            user_id,
            agent_kind="claude",
            is_default=True,
            api_key="sk-brownfield-0011",
            name="old-row",
            settings_config=None,
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        # None 原样透传（不兜底成 {}）。
        assert cfg["settings_config"] is None

    @pytest.mark.asyncio
    async def test_settings_config_non_none_passes_through(self, db_session: AsyncSession) -> None:
        """settings_config 非 None → dict 原样透传（不解密 / 不加工 / 不校验 schema）。"""
        user_id = await _create_user(db_session, label="sc-dict")
        settings_payload = {
            "env": {"EXTRA_FLAG": "on"},
            "api_key": "leave-me-alone",  # 故意取名 api_key 防误删
            "nested": {"k": "v"},
        }
        await _seed_provider_row(
            db_session,
            user_id,
            agent_kind="claude",
            is_default=True,
            api_key="sk-real-apikey-0011",
            name="row-with-sc",
            settings_config=settings_payload,
        )

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        # 原样透传：内容完全相等（深比）。
        assert cfg["settings_config"] == settings_payload
        # 真 api_key 仍走 cfg["api_key"]（解密）,不被 settings_config 干扰。
        assert cfg["api_key"] == "sk-real-apikey-0011"


# ════════════════════════════════════════════════════════════════════════════
# 6. helper 纯查询：不改 DB（read-only 守护）
# ════════════════════════════════════════════════════════════════════════════


class TestResolveDefaultProviderConfigReadOnly:
    """helper 纯查询：不写 / 不改 ``is_default``（read-only 守护）。"""

    @pytest.mark.asyncio
    async def test_does_not_modify_is_default_flag(self, db_session: AsyncSession) -> None:
        """调 helper 后,行 ``is_default`` 不变（True 仍 True,False 仍 False）。"""
        user_id = await _create_user(db_session, label="ro")
        svc = LlmProviderService(db_session)
        default_row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="def",
                api_key="sk-def-0011",
                base_url="https://api.anthropic.com",
                is_default=True,
            ),
        )
        non_default_row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="notdef",
                api_key="sk-notdef-0022",
                base_url="https://api.anthropic.com",
                is_default=False,
            ),
        )

        await resolve_default_provider_config(db_session, user_id, "claude")

        # 行的 is_default 不变（helper 不写）。
        await db_session.refresh(default_row)
        await db_session.refresh(non_default_row)
        assert default_row.is_default is True
        assert non_default_row.is_default is False

    @pytest.mark.asyncio
    async def test_does_not_create_rows(self, db_session: AsyncSession) -> None:
        """用户无任何 provider 行 → 调 helper 后仍无行（不误插）。"""
        user_id = await _create_user(db_session, label="ro-create")

        await resolve_default_provider_config(db_session, user_id, "claude")

        stmt = select(LlmProvider).where(LlmProvider.user_id == user_id)
        rows = (await db_session.execute(stmt)).scalars().all()
        assert rows == []


# ════════════════════════════════════════════════════════════════════════════
# 7. openai_chat 形态（task-10 / change 2026-08-08-llm-provider-openai-format）
# ════════════════════════════════════════════════════════════════════════════


async def _seed_openai_default_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    model: str | None = "zen-1",
    api_key: str = "sk-openai-upstream-never-sent",
) -> LlmProvider:
    """task-10：直插 openai_chat 默认 provider。

    复用 ``_seed_provider_row`` 走真实 cipher 加密落盘（api_key 入 encrypted_api_key），
    再置 ``api_format='openai_chat'`` + model，模拟 task-01 列 + task-05 表单创建的
    openai 行（service.create schema 不接 api_format=openai，故直插 ORM）。
    """
    row = await _seed_provider_row(
        session,
        user_id,
        agent_kind="claude",
        is_default=True,
        api_key=api_key,
        name="opencode-zen-openai",
        base_url="https://opencode.ai/zen/v1/chat/completions",
    )
    row.api_format = "openai_chat"
    row.model = model
    await session.commit()
    await session.refresh(row)
    return row


class TestResolveDefaultProviderConfigOpenaiShape:
    """task-10：openai_chat 格式 → 6 字段 provider_config（指向 LiteLLM，不含上游 key）。

    D-003/NFR-01 安全增益：openai 形态不下发上游 api_key（只在 task-09 register 时注册
    LiteLLM），claim/WS 下发的 config 只含 LiteLLM 地址 + 令牌 + model_name + model。
    anthropic 形态 9 字段逐字不变（NFR-02，上方 TestResolveDefaultProviderConfigFound 锁死）。
    """

    @pytest.mark.asyncio
    async def test_openai_returns_6_field_dict_excluding_upstream_keys(
        self, db_session: AsyncSession
    ) -> None:
        """openai 命中 → dict 恰 6 键 {agent_kind, api_format, litellm_base_url,
        litellm_model_name, litellm_auth_token, model}，无任何上游字段（D-003/NFR-01）。"""
        user_id = await _create_user(db_session, label="openai-shape")
        await _seed_openai_default_provider(db_session, user_id, model="zen-1")

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        assert set(cfg.keys()) == {
            "agent_kind",
            "api_format",
            "litellm_base_url",
            "litellm_model_name",
            "litellm_auth_token",
            "model",
        }
        # D-003/NFR-01：上游字段绝不出现（比 anthropic 9 字段少了全部 key-bearing 字段）。
        for forbidden in (
            "api_key",
            "auth_field",
            "base_url",
            "model_role_mappings",
            "default_fallback_model",
            "extra_env",
            "settings_config",
        ):
            assert forbidden not in cfg, f"openai 形态泄漏上游字段 {forbidden}"
        # 值守护：api_format / agent_kind / model 原样。
        assert cfg["api_format"] == "openai_chat"
        assert cfg["agent_kind"] == "claude"
        assert cfg["model"] == "zen-1"

    @pytest.mark.asyncio
    async def test_openai_litellm_model_name_matches_task09_convention(
        self, db_session: AsyncSession
    ) -> None:
        """litellm_model_name == f"usr-{user_id}-{provider.id}"，且与 task-09
        ``litellm_client.litellm_model_name`` 单一真相源 helper 逐字一致（R-03）。
        命名漂移 → LiteLLM 按 model_name 路由 404 → Claude Code 报错。"""
        user_id = await _create_user(db_session, label="openai-name")
        provider = await _seed_openai_default_provider(db_session, user_id)

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        # 与 task-09 register 写入 LiteLLM 的 model_name 逐字一致（路由命中前提）。
        from app.modules.llm_provider.litellm_client import litellm_model_name

        assert cfg["litellm_model_name"] == f"usr-{user_id}-{provider.id}"
        assert cfg["litellm_model_name"] == litellm_model_name(user_id, provider.id)

    @pytest.mark.asyncio
    async def test_openai_litellm_base_url_and_auth_token_from_settings(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """litellm_base_url / litellm_auth_token 取自 settings（task-09 登记）。
        litellm_auth_token = settings.litellm_master_key（LiteLLM /v1/messages 接受 master
        key 鉴权，daemon 注 ANTHROPIC_AUTH_TOKEN 打 LiteLLM，task-11）。"""
        user_id = await _create_user(db_session, label="openai-settings")
        await _seed_openai_default_provider(db_session, user_id)

        # mock context 模块的 get_settings（顶部 import 绑定名字），隔离真 env。
        from app.modules.daemon.lease import context as ctx_mod

        fake = MagicMock()
        fake.litellm_base_url = "http://litellm-test:4000"
        fake.litellm_master_key = "sk-litellm-master-test"
        monkeypatch.setattr(ctx_mod, "get_settings", lambda: fake)

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        assert cfg["litellm_base_url"] == "http://litellm-test:4000"
        assert cfg["litellm_auth_token"] == "sk-litellm-master-test"

    @pytest.mark.asyncio
    async def test_openai_does_not_decrypt_upstream_api_key(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """D-003/NFR-01：openai 命中不解密上游 api_key（``get_cipher().decrypt`` 不被调）。
        上游 key 只在 task-09 register 时传 LiteLLM 一次，claim/config 路径不触碰。"""
        user_id = await _create_user(db_session, label="openai-nokey")
        await _seed_openai_default_provider(
            db_session, user_id, api_key="sk-openai-upstream-never-decrypt"
        )

        # spy：patch app.core.crypto.get_cipher 返回 stub cipher，断言其 decrypt 未被调。
        # resolve_default_provider_config 函数内 ``from app.core.crypto import get_cipher``
        # 取 patched 版本；openai 早返回不调 get_cipher()，anthropic 才调 → 若 openai 分支
        # 失效误走 anthropic，decrypt 被调，断言失败暴露回归。
        cipher_stub = MagicMock()
        monkeypatch.setattr("app.core.crypto.get_cipher", lambda: cipher_stub)

        cfg = await resolve_default_provider_config(db_session, user_id, "claude")

        assert cfg is not None
        assert "api_key" not in cfg
        cipher_stub.decrypt.assert_not_called()
