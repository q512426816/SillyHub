"""task-03（change 2026-08-14-sessions-portal）``create_session`` 配置接线单测。

覆盖 design §5 Wave1 第 1-4 点 + §9 兼容策略 + Grill C-01（runtime_id 钉定，
P0）+ D-013（档案只注 system_prompt + mcp/skill，不派生引擎/模型/供应商）：

1. runtime_id 钉定命中：lease / session 定位到指定 runtime，**不走**
   ``_get_online_runtime`` 的 first-online 选择（心跳更新的 runtime 不被选中）
   与 provider 不在线 fallback；
2. 钉定不可满足（离线 / 不存在 / 他人 runtime）→ AppError 4xx，**不静默换机**，
   且无半成品 session 落库；
3. provider 旧路径（/runtimes 弹窗，不传新字段）逐字段与现状一致（零回归）；
4. 档案注入只写 system_prompt + mcp_refs/skill_refs（不写 bound
   ``llm_provider_id`` / ``effective_allowed_roots``，D-013）；
5. 会话级供应商：归属 + agent_kind 校验，写独立 metadata key
   ``session_llm_provider_id``；
6. config_snapshot 落库字段齐全（含 machine_name / agent_name，Grill C-12）。

夹具范式镜像 ``test_session_service.py``（hub / redis mock + in-memory SQLite）；
LlmProvider 落盘镜像 ``test_lease_context_provider_priority.py::_seed_provider``
（真实 cipher 加密）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.daemon.model import (
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
    DaemonSessionRuntimeNotFound,
    DaemonSessionRuntimeUnavailable,
)
from app.modules.llm_provider.model import LlmProvider

# ── Fixtures / helpers ───────────────────────────────────────────────────────


async def _create_user(session: AsyncSession, *, admin: bool = False) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"t03-{uid}@example.com",
            password_hash="x",
            display_name="T03",
            status="active",
            is_platform_admin=admin,
        )
    )
    await session.commit()
    return uid


async def _create_instance(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "host-a",
    display_alias: str | None = None,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        display_alias=display_alias,
        server_url="https://sillyhub.example.com",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(inst)
    await session.commit()
    return inst


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    provider: str = "claude",
    status: str = "online",
    name: str | None = "Claude Code",
    instance: DaemonInstance | None = None,
    heartbeat: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=instance.id if instance else None,
        name=name,
        provider=provider,
        status=status,
        last_heartbeat_at=heartbeat or datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    return rt


async def _create_profile(
    session: AsyncSession,
    owner_id: uuid.UUID,
    *,
    name: str = "海盗人格",
    provider: str = "claude",
    system_prompt: str | None = None,
    mcp_refs: list[str] | None = None,
    skill_refs: list[str] | None = None,
    llm_provider_id: uuid.UUID | None = None,
    visibility: AgentProfileVisibility = AgentProfileVisibility.PRIVATE,
    model: str | None = None,
) -> AgentProfile:
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name,
        owner_user_id=owner_id,
        visibility=visibility,
        provider=provider,
        model=model,
        system_prompt=system_prompt,
        mcp_refs=mcp_refs or [],
        skill_refs=skill_refs or [],
        llm_provider_id=llm_provider_id,
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
    name: str = "GLM",
) -> LlmProvider:
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


async def _count(session: AsyncSession, model) -> int:
    rows = (await session.execute(select(model))).scalars().all()
    return len(rows)


# ════════════════════════════════════════════════════════════════════════════
# 1. runtime_id 钉定（Grill C-01 / P0）
# ════════════════════════════════════════════════════════════════════════════


class TestRuntimeIdPinning:
    @pytest.mark.asyncio
    async def test_runtime_id_pins_selected_runtime_not_first_online(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """钉定命中：指定 runtime B（心跳更旧），first-online 本会选 A——不得改道。"""
        # Arrange：A 心跳更新（_query_online ORDER BY last_heartbeat_at DESC 会先选 A）。
        uid = await _create_user(db_session)
        now = datetime.now(UTC)
        await _create_runtime(db_session, uid, provider="claude", heartbeat=now)
        rt_b = await _create_runtime(
            db_session,
            uid,
            provider="codex",
            heartbeat=now - timedelta(minutes=10),
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt_b.id))

        # Assert：session 与 lease 都钉在 B 上，provider 从 B 派生为 codex。
        assert result.agent_session.runtime_id == rt_b.id
        assert result.agent_session.provider == "codex"
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert lease.runtime_id == rt_b.id
        assert lease.metadata_["provider"] == "codex"

    @pytest.mark.asyncio
    async def test_pinned_runtime_offline_rejects_without_fallback(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """钉定 runtime 离线 → 4xx，绝不静默换到其它在线 runtime。"""
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid, provider="claude")  # 在线备选
        rt_offline = await _create_runtime(db_session, uid, provider="claude", status="offline")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeUnavailable) as exc_info:
            await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt_offline.id))
        assert exc_info.value.http_status == 409

        # Assert：无半成品落库（校验在事务前，rollback 后无残留）。
        assert await _count(db_session, AgentSession) == 0
        assert await _count(db_session, AgentRun) == 0
        assert await _count(db_session, DaemonTaskLease) == 0

    @pytest.mark.asyncio
    async def test_pinned_runtime_of_other_user_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """他人 runtime → 404（不泄露存在性），不换机。"""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt_foreign = await _create_runtime(db_session, other, provider="claude")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeNotFound) as exc_info:
            await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt_foreign.id))
        assert exc_info.value.http_status == 404
        assert await _count(db_session, AgentSession) == 0

    @pytest.mark.asyncio
    async def test_unknown_runtime_id_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeNotFound):
            await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(uuid.uuid4()))


# ════════════════════════════════════════════════════════════════════════════
# 2. provider 旧路径零回归（design §9）
# ════════════════════════════════════════════════════════════════════════════


class TestProviderLegacyPathZeroRegression:
    @pytest.mark.asyncio
    async def test_provider_path_fields_unchanged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """不传 runtime_id/档案/供应商：三列 NULL、snapshot NULL、lease metadata 无新键。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="hello")

        s = result.agent_session
        run = result.agent_run
        # 会话三列 = 现状（NULL）。
        assert s.agent_profile_id is None
        assert s.llm_provider_id is None
        assert s.config_snapshot is None
        assert s.runtime_id == rt.id  # first-online 命中唯一在线 runtime
        # 首 run 无档案/供应商快照。
        assert run.agent_profile_id is None
        assert run.agent_profile_snapshot is None
        assert run.llm_provider_id is None

        # lease metadata 逐字段 = 既有键集合（无任何 task-03 新键）。
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert meta["provider"] == "claude"
        assert meta["prompt"] == "hello"
        assert meta["session_id"] == str(s.id)
        assert meta["run_id"] == str(run.id)
        assert meta["manual_approval"] is True
        assert meta["ask_user_only"] is True
        assert "claim_token" in meta
        for absent in (
            "system_prompt",
            "mcp_refs",
            "skill_refs",
            "session_llm_provider_id",
            "llm_provider_id",
            "effective_allowed_roots",
        ):
            assert absent not in meta, f"legacy path must not write {absent}"


# ════════════════════════════════════════════════════════════════════════════
# 3. 档案注入（D-013：只 system_prompt + mcp/skill）
# ════════════════════════════════════════════════════════════════════════════


class TestProfileInjection:
    @pytest.mark.asyncio
    async def test_profile_injects_system_prompt_and_refs_only(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """选档案：lease metadata 只多 system_prompt/mcp_refs/skill_refs 三键。

        D-013：档案绑定供应商（bound llm_provider_id）、model、overlay 一律不读
        不写——会话供应商由独立 key session_llm_provider_id 承载。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        bound = await _seed_provider(db_session, uid)
        profile = await _create_profile(
            db_session,
            uid,
            system_prompt="You are a pirate.",
            mcp_refs=["mcp-a"],
            skill_refs=["skill-a"],
            llm_provider_id=bound.id,
            model="profile-model-x",
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            agent_profile_id=str(profile.id),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert meta["system_prompt"] == "You are a pirate."
        assert meta["mcp_refs"] == ["mcp-a"]
        assert meta["skill_refs"] == ["skill-a"]
        # D-013 红线：不写 bound 供应商 key、不写沙箱交集、不写 model。
        assert "llm_provider_id" not in meta
        assert "effective_allowed_roots" not in meta
        assert meta.get("model") is None

        # 会话与首 run 落档案绑定 + 快照。
        s, run = result.agent_session, result.agent_run
        assert s.agent_profile_id == profile.id
        assert run.agent_profile_id == profile.id
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot["system_prompt"] == "You are a pirate."
        assert run.agent_profile_snapshot["name"] == "海盗人格"
        # 快照 chips 字段。
        assert s.config_snapshot is not None
        assert s.config_snapshot is not None
        assert s.config_snapshot["profile_name"] == "海盗人格"

    @pytest.mark.asyncio
    async def test_profile_without_system_prompt_writes_refs_only(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """空 system_prompt → 不写 system_prompt 键（行为同 _apply_profile_to_lease）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        profile = await _create_profile(db_session, uid, system_prompt=None, mcp_refs=["mcp-b"])

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            agent_profile_id=str(profile.id),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert "system_prompt" not in meta
        assert meta["mcp_refs"] == ["mcp-b"]

    @pytest.mark.asyncio
    async def test_invisible_profile_rejected(self, db_session, mocked_hub, mocked_redis) -> None:
        """他人 private 档案 → 403（AgentProfilePermissionDenied），无半成品。"""
        from app.modules.agent.profile.service import AgentProfilePermissionDenied

        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        foreign_profile = await _create_profile(db_session, other, system_prompt="secret")

        svc = DaemonService(db_session)
        with pytest.raises(AgentProfilePermissionDenied):
            await svc.create_session(
                uid,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                agent_profile_id=str(foreign_profile.id),
            )
        assert await _count(db_session, AgentSession) == 0

    @pytest.mark.asyncio
    async def test_missing_profile_rejected_404(self, db_session, mocked_hub, mocked_redis) -> None:
        from app.modules.agent.profile.service import AgentProfileNotFound

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        with pytest.raises(AgentProfileNotFound):
            await svc.create_session(
                uid,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                agent_profile_id=str(uuid.uuid4()),
            )


# ════════════════════════════════════════════════════════════════════════════
# 4. 会话级供应商（FR-04 / R-02 独立 key）
# ════════════════════════════════════════════════════════════════════════════


class TestSessionLlmProvider:
    @pytest.mark.asyncio
    async def test_session_provider_written_to_lease_metadata(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """选供应商：写 session_llm_provider_id（非 bound key），三列+快照落库。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        provider_row = await _seed_provider(
            db_session, uid, agent_kind="claude", model="glm-4.7", name="GLM"
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            llm_provider_id=str(provider_row.id),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert meta["session_llm_provider_id"] == str(provider_row.id)
        assert "llm_provider_id" not in meta  # bound key 不写（R-02 key 纪律）

        s, run = result.agent_session, result.agent_run
        assert s.llm_provider_id == provider_row.id
        assert run.llm_provider_id == provider_row.id
        assert s.config_snapshot is not None
        assert s.config_snapshot["provider_name"] == "GLM"
        assert s.config_snapshot["model"] == "glm-4.7"

    @pytest.mark.asyncio
    async def test_other_users_provider_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """他人供应商 → 404（归属校验按 AgentSession.user_id），不泄露凭证。"""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        foreign = await _seed_provider(db_session, other, agent_kind="claude")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionLlmProviderNotFound) as exc_info:
            await svc.create_session(
                uid,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                llm_provider_id=str(foreign.id),
            )
        assert exc_info.value.http_status == 404
        assert await _count(db_session, AgentSession) == 0

    @pytest.mark.asyncio
    async def test_agent_kind_mismatch_returns_422(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """codex 供应商配 claude 引擎 → 422（FR-06 防错配），不静默降级。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        codex_provider = await _seed_provider(
            db_session, uid, agent_kind="codex", name="Codex 凭证"
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionLlmProviderKindMismatch) as exc_info:
            await svc.create_session(
                uid,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                llm_provider_id=str(codex_provider.id),
            )
        assert exc_info.value.http_status == 422
        assert await _count(db_session, AgentSession) == 0


# ════════════════════════════════════════════════════════════════════════════
# 5. config_snapshot 落库（Grill C-12：含 machine_name / agent_name）
# ════════════════════════════════════════════════════════════════════════════


class TestConfigSnapshot:
    @pytest.mark.asyncio
    async def test_snapshot_contains_machine_and_agent_names(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """display_alias 优先于 hostname；agent_name 取 runtime.name。"""
        uid = await _create_user(db_session)
        inst = await _create_instance(db_session, uid, hostname="host-a", display_alias="我的 Mac")
        rt = await _create_runtime(
            db_session, uid, provider="claude", name="Claude Code", instance=inst
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt.id))

        snap = result.agent_session.config_snapshot
        assert snap is not None
        assert snap["machine_name"] == "我的 Mac"
        assert snap["agent_name"] == "Claude Code"
        assert snap["engine"] == "claude"
        assert snap["profile_name"] is None
        assert snap["provider_name"] is None
        assert snap["model"] is None

    @pytest.mark.asyncio
    async def test_snapshot_machine_name_falls_back_to_hostname(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        uid = await _create_user(db_session)
        inst = await _create_instance(db_session, uid, hostname="host-b")
        rt = await _create_runtime(db_session, uid, provider="claude", name=None, instance=inst)

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt.id))

        snap = result.agent_session.config_snapshot
        assert snap is not None
        assert snap["machine_name"] == "host-b"
        # runtime.name 为空 → agent_name 回退 provider。
        assert snap["agent_name"] == "claude"

    @pytest.mark.asyncio
    async def test_full_config_snapshot_with_profile_and_provider(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """runtime + 档案 + 供应商齐选 → 快照六字段全落。"""
        uid = await _create_user(db_session)
        inst = await _create_instance(db_session, uid, hostname="host-c")
        rt = await _create_runtime(db_session, uid, provider="claude", name="CC", instance=inst)
        profile = await _create_profile(db_session, uid, system_prompt="p")
        provider_row = await _seed_provider(db_session, uid, model="glm-4.7")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            agent_profile_id=str(profile.id),
            llm_provider_id=str(provider_row.id),
        )

        snap = result.agent_session.config_snapshot
        assert snap == {
            "profile_name": "海盗人格",
            "provider_name": "GLM",
            "model": "glm-4.7",
            "engine": "claude",
            "machine_name": "host-c",
            "agent_name": "CC",
        }
