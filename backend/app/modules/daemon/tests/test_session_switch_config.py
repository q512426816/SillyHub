"""task-05（change 2026-08-14-sessions-portal）``inject_session`` 配置热切换单测。

覆盖 design §5 Wave1 inject 段 + §7.2 SESSION_SWITCH_CONFIG 契约 + §7.4 生命周期
契约表「switch config」行 + FR-05/FR-06 + D-008@v1/D-012@v1/D-013@v1 + Grill
C-05/C-11：

1. 切档案 + 切供应商成功：新 AgentRun 带新快照、会话三列更新、lease metadata
   同步、WS 消息 payload（camelCase，对齐 task-08 SessionSwitchConfigPayload）；
2. 单维切换（只档案 / 只供应商）：另一维 payload 为 null，run 快照沿用会话
   当前值（轮次快照完整性，D-008）；
3. ``llm_provider_id`` 空串（"none"）→ 清空会话供应商回本机默认（写 NULL）；
   已 NULL 时等价不动（落回原 SESSION_INJECT 路径）；
4. 校验：agent_kind 错配 422（FR-06）、他人供应商 404（归属按
   ``AgentSession.user_id``，Grill C-05 借用场景 borrower 供应商不被拒）、
   他人档案 403、非 UUID 422——失败时会话状态与列不变、无新 run、无 WS 调用；
5. send 失败收敛（Grill C-11）：run→failed、session 保持 active、会话三列保留
   新配置（可重试收敛）；
6. 未传新配置（两者都 None）→ 原有 inject 行为逐字段不变（零回归：
   SESSION_INJECT 消息 snake_case、run 无配置快照字段、会话列不动）。

夹具范式镜像 ``test_session_create_config.py``（task-03）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DAEMON_MSG_SESSION_SWITCH_CONFIG,
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
)
from app.modules.llm_provider.model import LlmProvider

# ── Fixtures / helpers（镜像 test_session_create_config.py）──────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"t05-{uid}@example.com",
            password_hash="x",
            display_name="T05",
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
    mcp_refs: list[str] | None = None,
    skill_refs: list[str] | None = None,
    visibility: AgentProfileVisibility = AgentProfileVisibility.PRIVATE,
) -> AgentProfile:
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name,
        owner_user_id=owner_id,
        visibility=visibility,
        provider="claude",
        system_prompt=system_prompt,
        mcp_refs=mcp_refs or [],
        skill_refs=skill_refs or [],
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


async def _finish_first_turn(db_session: AsyncSession, result) -> None:
    """把 create_session 的首 run 置 completed，让 inject 无冲突。"""
    result.agent_run.status = "completed"
    result.agent_run.finished_at = datetime.now(UTC)
    await db_session.commit()


async def _session_runs(db_session: AsyncSession, session_id: uuid.UUID) -> list[AgentRun]:
    return list(
        (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == session_id)))
        .scalars()
        .all()
    )


# ════════════════════════════════════════════════════════════════════════════
# 1. 切换成功（档案 + 供应商）
# ════════════════════════════════════════════════════════════════════════════


class TestSwitchSuccess:
    @pytest.mark.asyncio
    async def test_switch_profile_and_provider_full(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """双维切换：新 run 快照 + 会话三列 + config_snapshot + lease metadata + WS 原子消息。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(
            db_session, uid, name="海盗", system_prompt="You are a pirate.", mcp_refs=["mcp-a"]
        )
        profile_b = await _create_profile(
            db_session,
            uid,
            name="忍者",
            system_prompt="You are a ninja.",
            mcp_refs=["mcp-b"],
            skill_refs=["sk-b"],
        )
        provider_a = await _seed_provider(db_session, uid, model="glm-4.7", name="GLM")
        provider_b = await _seed_provider(db_session, uid, model="glm-5", name="GLM2")

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
        mocked_hub.send_session_control.reset_mock()

        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="switch turn",
            agent_profile_id=str(profile_b.id),
            llm_provider_id=str(provider_b.id),
        )

        # 新 run 带新快照（D-008：档案快照 + 供应商 id）。
        run = result.agent_run
        assert run.agent_profile_id == profile_b.id
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot["system_prompt"] == "You are a ninja."
        assert run.agent_profile_snapshot["name"] == "忍者"
        assert run.llm_provider_id == provider_b.id

        # 会话三列刷新 + config_snapshot（Grill C-12 口径）。
        await db_session.refresh(created.agent_session)
        s = created.agent_session
        assert s.status == "active"  # 切换不改状态机（FR-05）
        assert s.turn_count == 2
        assert s.agent_profile_id == profile_b.id
        assert s.llm_provider_id == provider_b.id
        assert s.config_snapshot is not None
        assert s.config_snapshot is not None
        assert s.config_snapshot["profile_name"] == "忍者"
        assert s.config_snapshot["provider_name"] == "GLM2"
        assert s.config_snapshot["model"] == "glm-5"
        assert s.config_snapshot["engine"] == "claude"

        # lease metadata 同步（同事务）。
        lease = await db_session.get(DaemonTaskLease, s.lease_id)
        meta = dict(lease.metadata_)
        assert meta["session_llm_provider_id"] == str(provider_b.id)
        assert meta["system_prompt"] == "You are a ninja."
        assert meta["mcp_refs"] == ["mcp-b"]
        assert meta["skill_refs"] == ["sk-b"]

        # WS：SESSION_SWITCH_CONFIG，payload 对齐 design §7.2 / task-08 契约（camelCase）。
        assert mocked_hub.send_session_control.await_count == 1
        msg_type, payload = (
            mocked_hub.send_session_control.await_args.args[1],
            mocked_hub.send_session_control.await_args.args[2],
        )
        assert msg_type == DAEMON_MSG_SESSION_SWITCH_CONFIG
        assert payload["sessionId"] == str(s.id)
        assert payload["runId"] == str(run.id)
        assert payload["prompt"] == "switch turn"
        assert payload["claimToken"] == meta["claim_token"]
        assert payload["profile"] == {
            "systemPrompt": "You are a ninja.",
            "mcpRefs": ["mcp-b"],
            "skillRefs": ["sk-b"],
        }
        assert payload["providerConfig"]["model"] == "glm-5"
        assert payload["providerConfig"]["agent_kind"] == "claude"
        assert payload["providerConfig"]["api_key"] == "sk-test-key"  # 解密后明文下发
        assert payload["providerConfig"]["base_url"] == provider_b.base_url

    @pytest.mark.asyncio
    async def test_switch_profile_only_provider_config_null(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """只切档案：providerConfig=null，run 供应商快照沿用会话当前值。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(db_session, uid, system_prompt="a")
        profile_b = await _create_profile(db_session, uid, name="新人格", system_prompt="b")
        provider_a = await _seed_provider(db_session, uid)

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
        mocked_hub.send_session_control.reset_mock()

        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="switch profile only",
            agent_profile_id=str(profile_b.id),
        )

        run = result.agent_run
        assert run.agent_profile_id == profile_b.id
        assert run.llm_provider_id == provider_a.id  # 未切维度沿用当前值

        await db_session.refresh(created.agent_session)
        assert created.agent_session.agent_profile_id == profile_b.id
        assert created.agent_session.llm_provider_id == provider_a.id

        payload = mocked_hub.send_session_control.await_args.args[2]
        assert mocked_hub.send_session_control.await_args.args[1] == (
            DAEMON_MSG_SESSION_SWITCH_CONFIG
        )
        assert payload["providerConfig"] is None
        assert payload["profile"]["systemPrompt"] == "b"

    @pytest.mark.asyncio
    async def test_switch_provider_only_profile_null(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """只切供应商：profile=null，run 档案快照沿用会话当前档案。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(db_session, uid, system_prompt="a")
        provider_a = await _seed_provider(db_session, uid, model="glm-4.7", name="GLM")
        provider_b = await _seed_provider(db_session, uid, model="glm-5", name="GLM2")

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
        mocked_hub.send_session_control.reset_mock()

        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="switch provider only",
            llm_provider_id=str(provider_b.id),
        )

        run = result.agent_run
        assert run.llm_provider_id == provider_b.id
        assert run.agent_profile_id == profile_a.id  # 未切维度沿用当前值
        assert run.agent_profile_snapshot is not None
        assert run.agent_profile_snapshot["system_prompt"] == "a"

        payload = mocked_hub.send_session_control.await_args.args[2]
        assert payload["profile"] is None
        assert payload["providerConfig"]["model"] == "glm-5"


# ════════════════════════════════════════════════════════════════════════════
# 2. 空串 "none" 清空供应商（前端「不指定」切回路径）
# ════════════════════════════════════════════════════════════════════════════


class TestClearProvider:
    @pytest.mark.asyncio
    async def test_empty_string_clears_provider_to_null(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """llm_provider_id="" → 会话/新 run 供应商均 NULL，消息 providerConfig=null，
        lease metadata 的 session_llm_provider_id 键被移除（回全局默认链）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        provider_a = await _seed_provider(db_session, uid)

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

        result = await svc.inject_session(
            created.agent_session.id, uid, prompt="back to default", llm_provider_id=""
        )

        assert result.agent_run.llm_provider_id is None
        await db_session.refresh(created.agent_session)
        assert created.agent_session.llm_provider_id is None
        assert created.agent_session.config_snapshot is not None
        assert created.agent_session.config_snapshot["provider_name"] is None
        assert created.agent_session.config_snapshot["model"] is None

        lease = await db_session.get(DaemonTaskLease, created.agent_session.lease_id)
        assert "session_llm_provider_id" not in dict(lease.metadata_)

        msg_type, payload = (
            mocked_hub.send_session_control.await_args.args[1],
            mocked_hub.send_session_control.await_args.args[2],
        )
        assert msg_type == DAEMON_MSG_SESSION_SWITCH_CONFIG
        assert payload["providerConfig"] is None
        assert payload["profile"] is None

    @pytest.mark.asyncio
    async def test_empty_string_when_already_none_is_plain_inject(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """会话本就无供应商时空串 = 不动 → 落回原 SESSION_INJECT（不误发切换消息）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        await svc.inject_session(created.agent_session.id, uid, prompt="noop", llm_provider_id="")

        assert mocked_hub.send_session_control.await_args.args[1] == DAEMON_MSG_SESSION_INJECT


# ════════════════════════════════════════════════════════════════════════════
# 3. 校验失败（FR-06 / Grill C-05）——4xx 且会话状态不变、无新 run、无 WS
# ════════════════════════════════════════════════════════════════════════════


class TestSwitchValidation:
    @pytest.mark.asyncio
    async def test_agent_kind_mismatch_422(self, db_session, mocked_hub, mocked_redis) -> None:
        """codex 供应商配 claude 引擎 → 422（FR-06），会话列与 run 数不变。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        codex_provider = await _seed_provider(
            db_session, uid, agent_kind="codex", name="Codex 凭证"
        )

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        with pytest.raises(DaemonSessionLlmProviderKindMismatch) as exc_info:
            await svc.inject_session(
                created.agent_session.id,
                uid,
                prompt="bad",
                llm_provider_id=str(codex_provider.id),
            )
        assert exc_info.value.http_status == 422

        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"
        assert created.agent_session.llm_provider_id is None  # 列不变
        assert len(await _session_runs(db_session, created.agent_session.id)) == 1
        mocked_hub.send_session_control.assert_not_called()

    @pytest.mark.asyncio
    async def test_other_users_provider_404(self, db_session, mocked_hub, mocked_redis) -> None:
        """他人供应商 → 404（归属按 AgentSession.user_id），不泄露凭证。"""
        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        foreign = await _seed_provider(db_session, other, agent_kind="claude")

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        sid = created.agent_session.id
        await _finish_first_turn(db_session, created)

        with pytest.raises(DaemonSessionLlmProviderNotFound) as exc_info:
            await svc.inject_session(
                sid,
                uid,
                prompt="foreign",
                llm_provider_id=str(foreign.id),
            )
        assert exc_info.value.http_status == 404
        assert len(await _session_runs(db_session, sid)) == 1

    @pytest.mark.asyncio
    async def test_borrow_runtime_provider_owned_by_session_user_ok(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """Grill C-05：runtime 属 admin、会话属 borrower——borrower 自己的供应商
        不得因 runtime 属主不同被静默拒绝（归属按 AgentSession.user_id）。"""
        admin = await _create_user(db_session)
        borrower = await _create_user(db_session)
        rt = await _create_runtime(db_session, admin)  # runtime 属主 = admin
        borrower_provider = await _seed_provider(db_session, borrower, name="borrower GLM")

        # 手工构造 active 会话（绕过 create 的 runtime 归属链路，模拟借用场景）。
        session_id = uuid.uuid4()
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            kind="interactive",
            status="claimed",
            lease_expires_at=None,
            attempt_number=1,
            metadata_={"session_id": str(session_id), "claim_token": "borrow-token"},
        )
        db_session.add(lease)
        await db_session.flush()
        db_session.add(
            AgentSession(
                id=session_id,
                user_id=borrower,
                runtime_id=rt.id,
                lease_id=lease.id,
                provider="claude",
                status="active",
                config={},
                turn_count=1,
                created_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            session_id,
            borrower,
            prompt="borrow switch",
            llm_provider_id=str(borrower_provider.id),
        )

        assert result.agent_run.llm_provider_id == borrower_provider.id
        assert mocked_hub.send_session_control.await_args.args[1] == (
            DAEMON_MSG_SESSION_SWITCH_CONFIG
        )

    @pytest.mark.asyncio
    async def test_foreign_profile_denied_403(self, db_session, mocked_hub, mocked_redis) -> None:
        """他人 private 档案 → 403（AgentProfilePermissionDenied，同 create 口径）。"""
        from app.modules.agent.profile.service import AgentProfilePermissionDenied

        uid = await _create_user(db_session)
        other = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        foreign_profile = await _create_profile(db_session, other, system_prompt="secret")

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        sid = created.agent_session.id
        await _finish_first_turn(db_session, created)

        with pytest.raises(AgentProfilePermissionDenied):
            await svc.inject_session(
                sid,
                uid,
                prompt="foreign profile",
                agent_profile_id=str(foreign_profile.id),
            )
        assert len(await _session_runs(db_session, sid)) == 1

    @pytest.mark.asyncio
    async def test_invalid_uuid_422(self, db_session, mocked_hub, mocked_redis) -> None:
        """非 UUID 形态 → 422（DaemonSessionConfigInvalid），两个入参都覆盖。"""
        from app.modules.daemon.session.service import DaemonSessionConfigInvalid

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider=None, prompt="first", runtime_id=str(rt.id)
        )
        # rollback 会 expire ORM 对象：先取 id，避免 raise 后访问属性触发同步 IO。
        sid = created.agent_session.id
        await _finish_first_turn(db_session, created)

        with pytest.raises(DaemonSessionConfigInvalid) as exc_info:
            await svc.inject_session(
                sid,
                uid,
                prompt="bad",
                agent_profile_id="not-a-uuid",
            )
        assert exc_info.value.http_status == 422

        with pytest.raises(DaemonSessionConfigInvalid):
            await svc.inject_session(
                sid,
                uid,
                prompt="bad",
                llm_provider_id="not-a-uuid",
            )
        assert len(await _session_runs(db_session, sid)) == 1


# ════════════════════════════════════════════════════════════════════════════
# 4. send 失败收敛（Grill C-11）
# ════════════════════════════════════════════════════════════════════════════


class TestSwitchFailureConvergence:
    @pytest.mark.asyncio
    async def test_send_failure_run_failed_session_active(self, db_session, mocked_redis) -> None:
        """切换消息 send 失败 → 新 run failed、session 保持 active、三列保留新配置
        （DB 先落、重试收敛）。"""
        from app.modules.daemon.service import DaemonRuntimeOffline

        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(db_session, uid, system_prompt="a")
        provider_b = await _seed_provider(db_session, uid, name="GLM2")

        good_hub = _mock_hub(connected=True)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=good_hub):
            svc = DaemonService(db_session)
            created = await svc.create_session(
                uid,
                provider=None,
                prompt="first",
                runtime_id=str(rt.id),
                agent_profile_id=str(profile_a.id),
            )
        await _finish_first_turn(db_session, created)

        bad_hub = _mock_hub(connected=True)
        bad_hub.send_session_control = AsyncMock(return_value=False)
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=bad_hub):
            svc = DaemonService(db_session)
            with pytest.raises(DaemonRuntimeOffline):
                await svc.inject_session(
                    created.agent_session.id,
                    uid,
                    prompt="switch offline",
                    llm_provider_id=str(provider_b.id),
                )

        await db_session.refresh(created.agent_session)
        assert created.agent_session.status == "active"  # 会话不中断
        assert created.agent_session.llm_provider_id == provider_b.id  # 三列保留新配置

        runs = await _session_runs(db_session, created.agent_session.id)
        failed = [r for r in runs if r.status == "failed"]
        assert len(failed) == 1
        assert failed[0].output_redacted is not None  # 可审计


# ════════════════════════════════════════════════════════════════════════════
# 5. 未传配置零回归（原有 inject 逐字段不变）
# ════════════════════════════════════════════════════════════════════════════


class TestPlainInjectZeroRegression:
    @pytest.mark.asyncio
    async def test_plain_inject_message_and_run_unchanged(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """不传切换参数：SESSION_INJECT 消息 snake_case 字段逐字不变，run 不带
        配置快照字段，会话三列不动——即使会话本身持有档案/供应商。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        profile_a = await _create_profile(db_session, uid, system_prompt="a")
        provider_a = await _seed_provider(db_session, uid)

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid,
            provider=None,
            prompt="first",
            runtime_id=str(rt.id),
            agent_profile_id=str(profile_a.id),
            llm_provider_id=str(provider_a.id),
        )
        snapshot_before = dict(created.agent_session.config_snapshot or {})
        await _finish_first_turn(db_session, created)
        mocked_hub.send_session_control.reset_mock()

        result = await svc.inject_session(created.agent_session.id, uid, prompt="second")

        # run：原有字段口径（无配置快照字段）。
        run = result.agent_run
        assert run.agent_profile_id is None
        assert run.agent_profile_snapshot is None
        assert run.llm_provider_id is None
        assert run.status == "pending"

        # 会话三列不动。
        await db_session.refresh(created.agent_session)
        assert created.agent_session.agent_profile_id == profile_a.id
        assert created.agent_session.llm_provider_id == provider_a.id
        assert created.agent_session.config_snapshot == snapshot_before

        # 消息：原 SESSION_INJECT（snake_case，含 runtime_id 鉴别字段）。
        msg_type, payload = (
            mocked_hub.send_session_control.await_args.args[1],
            mocked_hub.send_session_control.await_args.args[2],
        )
        assert msg_type == DAEMON_MSG_SESSION_INJECT
        assert set(payload.keys()) == {
            "session_id",
            "lease_id",
            "run_id",
            "prompt",
            "claim_token",
            "runtime_id",
        }
        assert payload["prompt"] == "second"
        assert payload["run_id"] == str(run.id)
