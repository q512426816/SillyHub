"""task-11（change 2026-08-29-usage-by-provider-model）``inject_session`` 会话级模型选择单测。

覆盖 design §4.2 + FR-03-3 / FR-03-4 / D-002@v1 + R-07（兜底模型遮蔽）：

1. 选模型：下发 daemon 的 ProviderConfig 快照 ``model`` 与
   ``default_fallback_model`` 同步为所选（credential-injector 规则3 优先级
   ``default_fallback_model ?? model``，仅改 model 会被供应商兜底模型静默遮蔽）；
   ``llm_providers`` 原配置不动（快照级覆盖）；config_snapshot.model 回填；
   空切换轮（prompt=""）run 落 completed；
2. model 非空而无供应商（llm_provider_id None/空串）→ 422，无新 run 无 WS；
3. model 空串切供应商 → 快照重置回**新供应商原配置**（旧所选模型无残留）；
4. 只切档案（不带 model 键）→ 会话级模型不动（快照展示 + 下发同步均沿用
   已选，防 daemon reload 回退兜底模型）；
5. model 空串同供应商（前端「默认（跟随供应商配置）」）→ 重置回供应商原配置；
6. 普通轮不带 model 键 → 原 SESSION_INJECT 路径零回归。

夹具范式镜像 ``test_session_switch_config.py``（task-05），``_seed_provider``
加 ``default_fallback_model`` 种子。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DAEMON_MSG_SESSION_SWITCH_CONFIG,
    DaemonSessionConfigInvalid,
)
from app.modules.llm_provider.model import LlmProvider

# ── Fixtures / helpers（镜像 test_session_switch_config.py）──────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"t11-{uid}@example.com",
            password_hash="x",
            display_name="T11",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    provider: str = "claude",
    status: str = "online",
    name: str | None = "Claude Code",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    return rt


async def _create_profile(
    session: AsyncSession,
    owner_id: uuid.UUID,
    *,
    name: str = "海盗人格",
    system_prompt: str | None = None,
) -> AgentProfile:
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name,
        owner_user_id=owner_id,
        visibility=AgentProfileVisibility.PRIVATE,
        provider="claude",
        system_prompt=system_prompt,
        mcp_refs=[],
        skill_refs=[],
    )
    session.add(profile)
    await session.commit()
    return profile


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    agent_kind: str = "claude",
    model: str | None = "glm-4.7",
    default_fallback_model: str | None = None,
    name: str = "GLM",
) -> LlmProvider:
    """task-11：加 ``default_fallback_model`` 种子（R-07 遮蔽场景必备）。"""
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-test-key")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kind=agent_kind,
        encrypted_api_key=ct,
        key_id=key_id,
        model=model,
        default_fallback_model=default_fallback_model,
        is_default=False,
        api_format="anthropic",
    )
    session.add(row)
    await session.commit()
    return row


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _finish_first_turn(db_session: AsyncSession, result) -> None:
    """把 create_session 的首 run 置 completed，让 inject 无冲突。"""
    result.agent_run.status = "completed"
    result.agent_run.finished_at = datetime.now(UTC)
    await db_session.commit()


def _switch_payload(mocked_hub: MagicMock) -> dict:
    """取最近一次 SESSION_SWITCH_CONFIG 的 payload（断言前置检查消息类型）。"""
    assert mocked_hub.send_session_control.await_args.args[1] == (DAEMON_MSG_SESSION_SWITCH_CONFIG)
    return mocked_hub.send_session_control.await_args.args[2]


async def _session_runs(db_session: AsyncSession, session_id: uuid.UUID) -> list[AgentRun]:
    return list(
        (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == session_id)))
        .scalars()
        .all()
    )


# ════════════════════════════════════════════════════════════════════════════
# 1. 选模型 → ProviderConfig 快照 model + default_fallback_model 同步（R-07）
# ════════════════════════════════════════════════════════════════════════════


class TestSelectModel:
    @pytest.mark.asyncio
    async def test_select_model_syncs_snapshot_and_fallback(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """选模型：下发快照 model/default_fallback_model=所选（供应商兜底模型
        不再遮蔽）；llm_providers 原配置不动；config_snapshot.model 回填；空
        prompt 切换轮 run 落 completed（daemon 只 reload）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(
            db_session,
            uid,
            model="glm-4.7",
            default_fallback_model="glm-flash",
            name="GLM",
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        # 前端契约：切模型同请求补带当前 llm_provider_id；静默切换 prompt=""。
        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="glm-4.7-air",
        )

        # R-07：下发快照同步 default_fallback_model=所选（仅改 model 会被
        # 供应商兜底模型 "glm-flash" 静默遮蔽）。
        payload = _switch_payload(mocked_hub)
        assert payload["providerConfig"]["model"] == "glm-4.7-air"
        assert payload["providerConfig"]["default_fallback_model"] == "glm-4.7-air"
        assert payload["profile"] is None  # 档案维度不切

        # config_snapshot.model 回填（展示用）。
        await db_session.refresh(created.agent_session)
        assert created.agent_session.config_snapshot["model"] == "glm-4.7-air"
        assert created.agent_session.llm_provider_id == provider_a.id  # 供应商不变

        # 快照级覆盖：llm_providers 原配置不动（约束：不动原配置）。
        await db_session.refresh(provider_a)
        assert provider_a.model == "glm-4.7"
        assert provider_a.default_fallback_model == "glm-flash"

        # 空切换轮：无 LLM turn，run 直接 completed。
        assert result.agent_run.status == "completed"

    @pytest.mark.asyncio
    async def test_select_model_with_provider_switch_combines(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """切供应商 + 选模型一步到位：快照带新供应商凭证 + 所选模型同步。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(db_session, uid, model="glm-4.7", name="GLM")
        provider_b = await _seed_provider(
            db_session, uid, model="kimi-k2", default_fallback_model="kimi-mini", name="Kimi"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_b.id),
            model="kimi-k2-thinking",
        )

        payload = _switch_payload(mocked_hub)
        assert payload["providerConfig"]["model"] == "kimi-k2-thinking"
        assert payload["providerConfig"]["default_fallback_model"] == "kimi-k2-thinking"
        await db_session.refresh(created.agent_session)
        assert created.agent_session.llm_provider_id == provider_b.id
        assert created.agent_session.config_snapshot["model"] == "kimi-k2-thinking"


# ════════════════════════════════════════════════════════════════════════════
# 2. model 非空而无供应商 → 422
# ════════════════════════════════════════════════════════════════════════════


class TestModelRequiresProvider:
    @pytest.mark.asyncio
    async def test_model_without_provider_422(self, db_session, mocked_hub, mocked_redis) -> None:
        """model 非空而 llm_provider_id=None（模型依赖供应商）→ 422，无新 run、
        无 WS 调用；空串 llm_provider_id（显式「不指定」）同样 422。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        sid = created.agent_session.id
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        with pytest.raises(DaemonSessionConfigInvalid) as exc_info:
            await svc.inject_session(sid, uid, prompt="pick model", model="glm-x")
        assert exc_info.value.http_status == 422
        assert exc_info.value.details["reason"] == "model_requires_provider"

        with pytest.raises(DaemonSessionConfigInvalid):
            await svc.inject_session(
                sid, uid, prompt="pick model", llm_provider_id="", model="glm-x"
            )

        assert len(await _session_runs(db_session, sid)) == 1
        mocked_hub.send_session_control.assert_not_called()


# ════════════════════════════════════════════════════════════════════════════
# 3. model 空串切供应商 → 快照重置回新供应商原配置
# ════════════════════════════════════════════════════════════════════════════


class TestProviderSwitchResetsModel:
    @pytest.mark.asyncio
    async def test_empty_model_on_provider_switch_resets(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """先选自定义模型，再带 model="" 切供应商 → 快照重置回新供应商原配置
        （旧所选模型无残留，config_snapshot / providerConfig 一致）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(
            db_session, uid, model="glm-4.7", default_fallback_model="glm-flash", name="GLM"
        )
        provider_b = await _seed_provider(
            db_session, uid, model="kimi-k2", default_fallback_model="kimi-mini", name="Kimi"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)

        # 第一步：在 A 上选自定义模型。
        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="glm-custom",
        )
        mocked_hub.send_session_control.reset_mock()

        # 第二步：带 model="" 切到 B（前端切供应商级联重置契约）。
        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_b.id),
            model="",
        )

        payload = _switch_payload(mocked_hub)
        # 重置回 B 原配置：无 "glm-custom" 残留，兜底还原（不走会话级覆盖）。
        assert payload["providerConfig"]["model"] == "kimi-k2"
        assert payload["providerConfig"]["default_fallback_model"] == "kimi-mini"
        await db_session.refresh(created.agent_session)
        assert created.agent_session.config_snapshot["model"] == "kimi-k2"
        assert created.agent_session.llm_provider_id == provider_b.id


# ════════════════════════════════════════════════════════════════════════════
# 4. 只切档案（不带 model 键）→ 会话级模型不动
# ════════════════════════════════════════════════════════════════════════════


class TestProfileSwitchKeepsModel:
    @pytest.mark.asyncio
    async def test_profile_switch_preserves_selected_model(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """只切档案（model 键缺省 None）→ 快照展示沿用已选模型，下发
        providerConfig 同步 model/default_fallback_model=已选（防 daemon reload
        回退供应商兜底模型，ql-20260817-008 同款回归面）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(db_session, uid, system_prompt="a")
        profile_b = await _create_profile(db_session, uid, name="新人格", system_prompt="b")
        provider_a = await _seed_provider(
            db_session, uid, model="glm-4.7", default_fallback_model="glm-flash", name="GLM"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            agent_profile_id=str(profile_a.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)

        # 先选自定义模型。
        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="glm-custom",
        )
        mocked_hub.send_session_control.reset_mock()

        # 只切档案：不带 model 键（前端契约：档案切换不带伴生键）。
        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            agent_profile_id=str(profile_b.id),
        )

        payload = _switch_payload(mocked_hub)
        assert payload["profile"]["systemPrompt"] == "b"
        # 模型不动：沿用已选（含下发同步，否则 reload 后回退 "glm-flash"）。
        assert payload["providerConfig"]["model"] == "glm-custom"
        assert payload["providerConfig"]["default_fallback_model"] == "glm-custom"
        await db_session.refresh(created.agent_session)
        assert created.agent_session.agent_profile_id == profile_b.id
        assert created.agent_session.config_snapshot["model"] == "glm-custom"


# ════════════════════════════════════════════════════════════════════════════
# 5. model 空串同供应商（「默认（跟随供应商配置）」）→ 重置回供应商原配置
# ════════════════════════════════════════════════════════════════════════════


class TestModelEmptyStringResets:
    @pytest.mark.asyncio
    async def test_empty_model_same_provider_resets_to_provider_config(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """model="" + 同供应商（等值）→ 构成切换轮重置回供应商原配置（前端
        「默认（跟随供应商配置）」选项路径，SWITCH_MODEL_DEFAULT_VALUE=""）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(
            db_session, uid, model="glm-4.7", default_fallback_model="glm-flash", name="GLM"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)

        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="glm-custom",
        )
        mocked_hub.send_session_control.reset_mock()

        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="",
        )

        payload = _switch_payload(mocked_hub)
        assert payload["providerConfig"]["model"] == "glm-4.7"
        assert payload["providerConfig"]["default_fallback_model"] == "glm-flash"
        await db_session.refresh(created.agent_session)
        assert created.agent_session.config_snapshot["model"] == "glm-4.7"


# ════════════════════════════════════════════════════════════════════════════
# 6. 普通轮不带 model 键 → 原 inject 路径零回归
# ════════════════════════════════════════════════════════════════════════════


class TestPlainTurnZeroRegression:
    @pytest.mark.asyncio
    async def test_plain_turn_without_model_key(self, db_session, mocked_hub, mocked_redis) -> None:
        """不带 model 键的普通轮：SESSION_INJECT 原路径，config_snapshot 不重建。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(
            db_session, uid, model="glm-4.7", default_fallback_model="glm-flash", name="GLM"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_a.id),
        )
        await _finish_first_turn(db_session, created)

        await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            llm_provider_id=str(provider_a.id),
            model="glm-custom",
        )
        snapshot_after_select = dict(created.agent_session.config_snapshot or {})
        mocked_hub.send_session_control.reset_mock()

        result = await svc.inject_session(created.agent_session.id, uid, prompt="plain turn")

        assert mocked_hub.send_session_control.await_args.args[1] == DAEMON_MSG_SESSION_INJECT
        assert result.agent_run.status == "pending"
        await db_session.refresh(created.agent_session)
        assert created.agent_session.config_snapshot == snapshot_after_select
        assert created.agent_session.config_snapshot["model"] == "glm-custom"
