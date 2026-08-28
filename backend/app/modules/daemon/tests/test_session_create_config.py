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
6. config_snapshot 落库字段齐全（含 machine_name / agent_name，Grill C-12）；
7. task-05 platform 共享档案分支（§1c）：检测前置二选一校验之前、只传共享
   档案放行、请求 runtime_id/workspace 被服务端覆写、tool_config 白名单无
   Bash/NotebookEdit（D-009）、grant 停用/离线回普通语义、不写借用审计
   （D-007）、管理员同 runtime 普通会话不受收紧（lease 级不污染断言）；
   task-12（D-011）：platform 会话 lease/claim 注入
   effective_allowed_roots=[writable_dir]（普通会话不含）。

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

from app.modules.agent.model import AgentRun, AgentSession, DaemonBorrowAudit
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import Role, RolePermission, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.model import (
    DaemonInstance,
    DaemonRuntime,
    DaemonTaskLease,
)
from app.modules.daemon.runtime.service import DaemonRuntimeNotFound, RuntimeService
from app.modules.daemon.schema import SessionCreateRequest
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
    DaemonSessionNotActive,
    DaemonSessionRuntimeNotFound,
    DaemonSessionRuntimeUnavailable,
)
from app.modules.llm_provider.model import LlmProvider

# task-03（2026-08-28-daemon-agent-share）：daemon_runtime_grants 建表注册。
# 根 conftest 的 db_engine 按当前进程已 import 的模型 create_all；本文件用例
# 需要 grants 表（钉定授权判定 / 审计关联），显式 import 保证确定性（模块
# import 发生在 fixture 建表前）。grants 空表时既有用例路径零行为变化（design §9）。
_ = DaemonRuntimeGrant

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


# ── task-03（2026-08-28-daemon-agent-share）：grants 授权钉定 seed helpers ─────
# 范式镜像 grants/tests/test_grants_authorization.py（task-02 先例）：角色带
# WORKSPACE_READ（create_session 的 workspace 归属校验）+ DAEMON_BORROW
# （authorize_pinned_runtime workspace 分支权限闸）。


async def _grant_workspace_role(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    permissions: list[str],
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"role-{uuid.uuid4().hex[:8]}",
        name="role",
        description="task-03 seed",
        is_system=False,
    )
    session.add(role)
    await session.flush()
    for p in permissions:
        session.add(RolePermission(role_id=role.id, permission=p))
    session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _seed_grant(
    session: AsyncSession,
    *,
    daemon_instance_id: uuid.UUID,
    granted_by: uuid.UUID,
    grantee_id: uuid.UUID | None,
    enabled: bool = True,
    grantee_type: str = "workspace",
    agent_profile_id: uuid.UUID | None = None,
    source_workspace_id: uuid.UUID | None = None,
    pinned_runtime_id: uuid.UUID | None = None,
    writable_dir: str | None = None,
) -> DaemonRuntimeGrant:
    grant = DaemonRuntimeGrant(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_instance_id,
        grantee_type=grantee_type,
        grantee_id=grantee_id,
        granted_by_user_id=granted_by,
        agent_profile_id=agent_profile_id,
        source_workspace_id=source_workspace_id,
        pinned_runtime_id=pinned_runtime_id,
        writable_dir=writable_dir,
        enabled=enabled,
    )
    session.add(grant)
    await session.commit()
    return grant


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
# 1b. 共享 runtime 钉定授权（task-03 / 2026-08-28-daemon-agent-share / FR-02）
#     design §5 Phase 2.1 + §7.5 生命周期契约表：owner 短路 → grants 授权判定，
#     workspace grant 命中按借用会话处理（marker + 审计含 grant_id）。
# ════════════════════════════════════════════════════════════════════════════


class TestPinnedGrantAuthorization:
    @pytest.mark.asyncio
    async def test_workspace_grant_pinned_session_allowed_with_audit(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """授权钉定放行：grant + 成员 + 权限 + 在线 → 201 语义，审计行含 grant_id。

        借用会话处理链（对齐批处理借用 / 交互式借用兜底）：lease metadata 带
        borrowed/lender_user_id + borrow_sandbox_slug（cwd 覆写为 marker）；
        daemon_borrow_audit 落 (borrower, lender, grant_id, workspace, run) 关联。
        """
        lender = await _create_user(db_session)
        actor = await _create_user(db_session)
        ws = await _create_workspace(db_session)
        await _grant_workspace_role(
            db_session,
            workspace_id=ws.id,
            user_id=actor,
            permissions=[Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
        )
        inst = await _create_instance(db_session, lender, hostname="lender-host")
        rt = await _create_runtime(db_session, lender, provider="claude", name="CC", instance=inst)
        grant = await _seed_grant(
            db_session,
            daemon_instance_id=inst.id,
            granted_by=lender,
            grantee_id=ws.id,
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            actor,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            workspace_id=ws.id,
        )

        # 钉定命中 lender 的 runtime，provider 从该 runtime 派生。
        assert result.agent_session.runtime_id == rt.id
        assert result.agent_session.provider == "claude"

        # lease metadata：借用标记 + 沙箱 marker（cwd 覆写，非 workspace root_path）。
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert meta["borrowed"] is True
        assert meta["lender_user_id"] == str(lender)
        assert meta["borrow_sandbox_slug"].startswith(f"borrow-{actor.hex[:8]}-")
        assert meta["cwd"] == f"borrow-sandbox:{meta['borrow_sandbox_slug']}"

        # 审计行：一行，含 grant_id / lender / borrower / workspace / run 关联。
        audits = (await db_session.execute(select(DaemonBorrowAudit))).scalars().all()
        assert len(audits) == 1
        row = audits[0]
        assert row.borrower_user_id == actor
        assert row.lender_user_id == lender
        assert row.grant_id == grant.id
        assert row.workspace_id == ws.id
        assert row.agent_run_id == result.agent_run.id
        assert row.daemon_instance_id == inst.id

    @pytest.mark.asyncio
    async def test_disabled_grant_pinned_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """停用 grant（enabled=False，撤销软开关）→ 404（授权失效，不泄露存在性）。"""
        lender = await _create_user(db_session)
        actor = await _create_user(db_session)
        ws = await _create_workspace(db_session)
        await _grant_workspace_role(
            db_session,
            workspace_id=ws.id,
            user_id=actor,
            permissions=[Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
        )
        inst = await _create_instance(db_session, lender)
        rt = await _create_runtime(db_session, lender, provider="claude", instance=inst)
        await _seed_grant(
            db_session,
            daemon_instance_id=inst.id,
            granted_by=lender,
            grantee_id=ws.id,
            enabled=False,
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeNotFound) as exc_info:
            await svc.create_session(
                actor,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                workspace_id=ws.id,
            )
        assert exc_info.value.http_status == 404
        assert await _count(db_session, AgentSession) == 0
        assert await _count(db_session, DaemonBorrowAudit) == 0

    @pytest.mark.asyncio
    async def test_non_member_pinned_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """非 grantee 工作区成员（无成员资格）→ 404（成员资格是授权条件）。"""
        lender = await _create_user(db_session)
        actor = await _create_user(db_session)
        ws = await _create_workspace(db_session)
        # actor 在 ws 无任何角色行（非成员）；grant 正常生效。
        inst = await _create_instance(db_session, lender)
        rt = await _create_runtime(db_session, lender, provider="claude", instance=inst)
        await _seed_grant(
            db_session,
            daemon_instance_id=inst.id,
            granted_by=lender,
            grantee_id=ws.id,
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeNotFound):
            await svc.create_session(
                actor,
                provider=None,
                prompt="hi",
                runtime_id=str(rt.id),
                workspace_id=ws.id,
            )
        assert await _count(db_session, AgentSession) == 0

    @pytest.mark.asyncio
    async def test_owner_pinned_session_writes_no_audit(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """owner 直用（自有 runtime 钉定）→ 不写借用审计（owner 短路零回归）。"""
        uid = await _create_user(db_session)
        inst = await _create_instance(db_session, uid)
        rt = await _create_runtime(db_session, uid, provider="claude", instance=inst)

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider=None, prompt="hi", runtime_id=str(rt.id))

        assert result.agent_session.runtime_id == rt.id
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert "borrowed" not in dict(lease.metadata_)
        assert await _count(db_session, DaemonBorrowAudit) == 0

    @pytest.mark.asyncio
    async def test_platform_grant_direct_pinned_without_profile_returns_404(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """D-012@v1（验收审查 gap-2）：不带共享档案、直接以 platform grant 的
        pinned_runtime_id 创建会话 → 404。

        直接钉定会绕过 task-05 强制（cwd/写约束/工具集），authorize 的 platform
        分支命中即 None 封堵；共享 runtime 唯一入口=共享档案检测（见
        TestPlatformProfileBranch，其下发走 pinned_skip_owner_check=True 不经
        authorize，不受影响）。零借用审计语义保持（无会话即无审计行）。
        """
        admin = await _create_user(db_session, admin=True)
        actor = await _create_user(db_session)
        src_ws = await _create_workspace(db_session, root_path="/srv/share/src")
        profile = await _create_profile(
            db_session, admin, visibility=AgentProfileVisibility.PLATFORM
        )
        inst = await _create_instance(db_session, admin)
        rt = await _create_runtime(db_session, admin, provider="claude", instance=inst)
        await _seed_grant(
            db_session,
            daemon_instance_id=inst.id,
            granted_by=admin,
            grantee_type="platform",
            grantee_id=None,
            agent_profile_id=profile.id,
            source_workspace_id=src_ws.id,
            pinned_runtime_id=rt.id,
            writable_dir="/srv/share/out",
        )

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionRuntimeNotFound) as exc_info:
            await svc.create_session(actor, provider=None, prompt="hi", runtime_id=str(rt.id))
        assert exc_info.value.http_status == 404
        assert await _count(db_session, AgentSession) == 0
        assert await _count(db_session, DaemonBorrowAudit) == 0

    @pytest.mark.asyncio
    async def test_mutation_endpoints_owner_only_for_grantee(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """FR-03 回归：共享者（持生效 grant + 借用权限）调 PATCH alias /
        PUT allowed-roots 仍 owner-only 404——授权只放行「用」，不放行「改」。
        """
        lender = await _create_user(db_session)
        actor = await _create_user(db_session)
        ws = await _create_workspace(db_session)
        await _grant_workspace_role(
            db_session,
            workspace_id=ws.id,
            user_id=actor,
            permissions=[Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
        )
        inst = await _create_instance(db_session, lender)
        rt = await _create_runtime(db_session, lender, provider="claude", instance=inst)
        await _seed_grant(
            db_session,
            daemon_instance_id=inst.id,
            granted_by=lender,
            grantee_id=ws.id,
        )

        rt_svc = RuntimeService(db_session)
        with pytest.raises(DaemonRuntimeNotFound) as exc_roots:
            await rt_svc.update_allowed_roots(rt.id, actor, allowed_roots=["D:/x"])
        assert exc_roots.value.http_status == 404

        with pytest.raises(DaemonRuntimeNotFound) as exc_alias:
            await rt_svc.update_runtime(
                rt.id,
                actor,
                display_alias="共享者的别名",
                display_alias_set=True,
            )
        assert exc_alias.value.http_status == 404
        # owner 本人不受影响（owner-only 语义未被破坏）。
        _, instance_row = await rt_svc.update_runtime(
            rt.id, lender, display_alias="主人别名", display_alias_set=True
        )
        assert instance_row is not None
        assert instance_row.display_alias == "主人别名"


# ════════════════════════════════════════════════════════════════════════════
# 1c. platform 共享档案分支（task-05 / 2026-08-28-daemon-agent-share / FR-04 /
#     D-002@v2 + D-007@v1 + D-009@v1）：检测前置二选一校验之前 + 服务端强制
#     钉定/cwd/工具集 + grant 停用回退 + 不写借用审计。
# ════════════════════════════════════════════════════════════════════════════


async def _seed_platform_shared_agent(
    session: AsyncSession,
    *,
    runtime_status: str = "online",
    enabled: bool = True,
):
    """task-05：admin 建 platform 共享智能体（grants platform 行 + 平台可见档案
    + 源码工作区 + 自己名下在线 runtime），actor 为普通用户（无自有机器）。"""
    from types import SimpleNamespace

    admin = await _create_user(session, admin=True)
    actor = await _create_user(session)
    src_ws = await _create_workspace(session, root_path="/srv/platform/src")
    profile = await _create_profile(
        session,
        admin,
        system_prompt="平台共享智能体人格",
        visibility=AgentProfileVisibility.PLATFORM,
    )
    inst = await _create_instance(session, admin, hostname="admin-host")
    rt = await _create_runtime(
        session, admin, provider="claude", name="Admin CC", instance=inst, status=runtime_status
    )
    grant = await _seed_grant(
        session,
        daemon_instance_id=inst.id,
        granted_by=admin,
        grantee_type="platform",
        grantee_id=None,
        agent_profile_id=profile.id,
        source_workspace_id=src_ws.id,
        pinned_runtime_id=rt.id,
        writable_dir="/srv/platform/out",
        enabled=enabled,
    )
    return SimpleNamespace(
        admin=admin,
        actor=actor,
        source_ws=src_ws,
        profile=profile,
        instance=inst,
        runtime=rt,
        grant=grant,
    )


class TestSessionCreateRequestDtoPlatformForm:
    """DTO 层二选一校验放行共享档案形态（E2E 缺陷回归，2026-08-28-daemon-agent-share）。

    线上缺陷：schema._require_runtime_or_provider 在 service 前置检测之前把
    只传 agent_profile_id 的请求 422——既有 TestPlatformProfileBranch 直调
    service 层绕过 DTO，未覆盖 HTTP 形态。修复后：带档案放行（服务端钉定/兜底），
    纯空形态仍 422。
    """

    def test_profile_only_form_passes_dto(self) -> None:
        req = SessionCreateRequest(
            prompt="帮我读下源码", agent_profile_id="857f7582-27f8-4764-b157-8fa2269177c3"
        )
        assert req.agent_profile_id == "857f7582-27f8-4764-b157-8fa2269177c3"

    def test_empty_form_still_rejected(self) -> None:
        import pytest as _pytest

        with _pytest.raises(ValueError, match="either runtime_id or provider"):
            SessionCreateRequest(prompt="x")


class TestPlatformProfileBranch:
    @pytest.mark.asyncio
    async def test_shared_profile_only_creates_pinned_session(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """只传共享档案（无 runtime_id/provider）→ 创建成功且全部强制项服务端施加。

        D-007@v1 Grill B-01 前置生效：钉定 grant 的 pinned runtime（provider 派生）、
        cwd=源码工作区 root_path、tool_config 白名单无 Bash/NotebookEdit（D-009）、
        无借用 marker、无 daemon_borrow_audit 行（D-007）。
        """
        seed = await _seed_platform_shared_agent(db_session)

        svc = DaemonService(db_session)
        result = await svc.create_session(
            seed.actor,
            provider=None,
            prompt="帮我读下源码",
            agent_profile_id=str(seed.profile.id),
        )

        # 钉定 + 派生 provider；档案绑定照落。
        s = result.agent_session
        assert s.runtime_id == seed.runtime.id
        assert s.provider == "claude"
        assert s.agent_profile_id == seed.profile.id

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        # cwd 强制 = 源码工作区 root_path（claim payload root_path 取 metadata.cwd）。
        assert meta["cwd"] == "/srv/platform/src"
        # tool_config：mode=acceptEdits + 白名单枚举（无 Bash/NotebookEdit，D-009）。
        tool_config = meta["tool_config"]
        assert tool_config["mode"] == "acceptEdits"
        assert set(tool_config["allowed_tools"]) == {
            "Read",
            "Glob",
            "Grep",
            "Edit",
            "Write",
            "mcp__sillyhub-file",
            "mcp__sillyhub-worker",
        }
        assert "Bash" not in tool_config["allowed_tools"]
        assert "NotebookEdit" not in tool_config["allowed_tools"]
        # platform 授权非借用：无 marker / 无审计行（D-007@v1）。
        assert "borrowed" not in meta
        assert "borrow_sandbox_slug" not in meta
        assert "lender_user_id" not in meta
        assert await _count(db_session, DaemonBorrowAudit) == 0
        # task-12（D-011 / spike-02 结论 B 修复）：writable_dir 写约束下推——lease
        # metadata 携带 effective_allowed_roots=[writable_dir]（mirror tool_config
        # 注入点；daemon 侧 policyEngine 分支自此真实消费 overlay 交集收紧）。
        assert meta["effective_allowed_roots"] == ["/srv/platform/out"]
        # claim payload 同样透传（_apply_profile_passthrough 逐键 in 守护，snake
        # +camel 双写）——daemon execPayload.effectiveAllowedRoots 读 camel 键。
        from app.modules.daemon.lease.context import build_claim_payload

        await db_session.refresh(lease)
        payload = await build_claim_payload(db_session, lease)
        assert payload["effective_allowed_roots"] == ["/srv/platform/out"]
        assert payload["effectiveAllowedRoots"] == ["/srv/platform/out"]

    @pytest.mark.asyncio
    async def test_request_runtime_and_workspace_overridden(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """同传 runtime_id/workspace_id + 共享档案 → 请求参数被服务端覆写（防伪造）。"""
        seed = await _seed_platform_shared_agent(db_session)
        # actor 自有机器 + 自己工作区（成员资格齐备，请求侧语义合法；命中检测
        # 后 runtime/cwd 语义应被无视——工作区归属校验本身照常通过）。
        own_rt = await _create_runtime(db_session, seed.actor, provider="codex")
        own_ws = await _create_workspace(db_session, root_path="D:/actor/own")
        await _grant_workspace_role(
            db_session,
            workspace_id=own_ws.id,
            user_id=seed.actor,
            permissions=[Permission.WORKSPACE_READ.value],
        )

        svc = DaemonService(db_session)
        result = await svc.create_session(
            seed.actor,
            provider="codex",
            prompt="hi",
            runtime_id=str(own_rt.id),
            workspace_id=own_ws.id,
            agent_profile_id=str(seed.profile.id),
        )

        # 钉定/引擎覆写为 grant 绑定；cwd 覆写为源码工作区（非请求 workspace root）。
        assert result.agent_session.runtime_id == seed.runtime.id
        assert result.agent_session.provider == "claude"
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert meta["cwd"] == "/srv/platform/src"
        # 工具集强制项同样施加（与只传档案形态一致，不因请求参数缺位）。
        assert meta["tool_config"]["mode"] == "acceptEdits"
        assert "Bash" not in meta["tool_config"]["allowed_tools"]
        # task-12（D-011）：写约束下推不因请求参数覆写而缺位（防伪造形态一致）。
        assert meta["effective_allowed_roots"] == ["/srv/platform/out"]
        # 借用语义零介入（钉定覆写 ≠ 借用）。
        assert "borrowed" not in meta
        assert await _count(db_session, DaemonBorrowAudit) == 0

    @pytest.mark.asyncio
    async def test_disabled_grant_falls_back_to_normal_semantics(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """grant 停用（enabled=False）→ 档案回普通语义：只传档案恢复二选一拒绝；
        带自有 runtime_id 走普通钉定（无 tool_config/cwd 覆写残留）。"""
        seed = await _seed_platform_shared_agent(db_session, enabled=False)

        svc = DaemonService(db_session)
        # 只传档案（无 runtime_id/provider）→ 原二选一校验拒绝。
        with pytest.raises(DaemonSessionNotActive) as exc_info:
            await svc.create_session(
                seed.actor,
                provider=None,
                prompt="hi",
                agent_profile_id=str(seed.profile.id),
            )
        assert (exc_info.value.details or {}).get("reason") == "missing_provider"
        assert await _count(db_session, AgentSession) == 0

        # 带自有 runtime_id → 普通档案会话（检测不命中，零覆写）。
        own_rt = await _create_runtime(db_session, seed.actor, provider="claude")
        result = await svc.create_session(
            seed.actor,
            provider=None,
            prompt="hi",
            runtime_id=str(own_rt.id),
            agent_profile_id=str(seed.profile.id),
        )
        assert result.agent_session.runtime_id == own_rt.id
        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        meta = dict(lease.metadata_)
        assert "tool_config" not in meta  # 无残留覆写
        assert "cwd" not in meta  # 无 workspace 上下文 → cwd 缺省（原语义）
        # 普通档案链路照常（system_prompt 注入）。
        assert meta["system_prompt"] == "平台共享智能体人格"

    @pytest.mark.asyncio
    async def test_offline_pinned_runtime_falls_back(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """pinned runtime 离线 → 检测不命中（共享智能体不可用），只传档案回落
        二选一 4xx——与前端 active 端点置灰离线条目一致。"""
        seed = await _seed_platform_shared_agent(db_session, runtime_status="offline")

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNotActive):
            await svc.create_session(
                seed.actor,
                provider=None,
                prompt="hi",
                agent_profile_id=str(seed.profile.id),
            )
        assert await _count(db_session, AgentSession) == 0

    @pytest.mark.asyncio
    async def test_admin_normal_session_same_runtime_not_tightened(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """管理员同 runtime 普通会话不受共享会话收紧（D-010/R-09，backend 层
        断言口径）：platform 下推字段（tool_config / effective_allowed_roots /
        借用 marker）只出现在 platform 会话的 lease metadata，不污染其它会话。"""
        seed = await _seed_platform_shared_agent(db_session)

        svc = DaemonService(db_session)
        # 先建一条 platform 会话（产生 tool_config 下推）。
        await svc.create_session(
            seed.actor,
            provider=None,
            prompt="hi",
            agent_profile_id=str(seed.profile.id),
        )
        # 管理员自己在同一 runtime 上建普通会话（runtime_id 直选，无档案）。
        admin_result = await svc.create_session(
            seed.admin,
            provider=None,
            prompt="hi",
            runtime_id=str(seed.runtime.id),
        )
        assert admin_result.agent_session.runtime_id == seed.runtime.id

        admin_lease = await db_session.get(DaemonTaskLease, admin_result.lease_id)
        admin_meta = dict(admin_lease.metadata_)
        for absent in ("tool_config", "effective_allowed_roots", "borrowed"):
            assert absent not in admin_meta, f"普通会话不应携带 {absent}"
        # 全库仍只有一条 lease 带 tool_config（platform 那条）。
        leases = (await db_session.execute(select(DaemonTaskLease))).scalars().all()
        with_tool_config = [x for x in leases if "tool_config" in dict(x.metadata_ or {})]
        assert len(with_tool_config) == 1
        # task-12（D-011）：effective_allowed_roots 同口径——仅 platform 那条携带
        # （零污染断言强化：admin 普通会话的写边界不受共享会话 overlay 影响）。
        with_overlay = [x for x in leases if "effective_allowed_roots" in dict(x.metadata_ or {})]
        assert len(with_overlay) == 1
        assert with_overlay[0].id != admin_lease.id
        assert dict(with_overlay[0].metadata_)["effective_allowed_roots"] == ["/srv/platform/out"]


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


# ════════════════════════════════════════════════════════════════════════════
# 7. quicklog_id 落绑定（task-08 / 2026-08-25-session-spec-binding / FR-04/06）
# ════════════════════════════════════════════════════════════════════════════


async def _create_workspace(session: AsyncSession, *, root_path: str = "/tmp/ql-ws"):
    """task-08：quicklog link 行的 workspace 维度落盘（对齐 test_change_session
    的 _make_workspace 形态）。"""
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="ql-ws",
        slug=f"ql-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    return ws


class TestQuicklogIdBinding:
    @pytest.mark.asyncio
    async def test_quicklog_id_writes_link(self, db_session, mocked_hub, mocked_redis) -> None:
        """带 quicklog_id+workspace_id 创建（经 DaemonService facade 透传）→
        quicklog_session_links 出现 (workspace, ql_id, session) 绑定行。"""
        from app.modules.change.model import QuicklogSessionLink

        uid = await _create_user(db_session, admin=True)
        rt = await _create_runtime(db_session, uid, provider="claude")
        ws = await _create_workspace(db_session)

        svc = DaemonService(db_session)
        ql_id = "ql-20260825-001-abc"
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            workspace_id=ws.id,
            quicklog_id=ql_id,
        )
        sid = result.agent_session.id

        link = (
            (
                await db_session.execute(
                    select(QuicklogSessionLink).where(
                        QuicklogSessionLink.workspace_id == ws.id,
                        QuicklogSessionLink.ql_id == ql_id,
                        QuicklogSessionLink.session_id == sid,
                    )
                )
            )
            .scalars()
            .first()
        )
        assert link is not None

    @pytest.mark.asyncio
    async def test_quicklog_id_without_workspace_skipped(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """quicklog_id 但无 workspace_id（link 行 NOT NULL）→ 记 warning 跳过，
        创建本身不受影响（无异常、无 link 行，201 语义保持）。"""
        from app.modules.change.model import QuicklogSessionLink

        uid = await _create_user(db_session, admin=True)
        await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt="hi",
            quicklog_id="ql-20260825-002-xyz",
        )
        assert result.agent_session.id is not None

        links = (await db_session.execute(select(QuicklogSessionLink))).scalars().all()
        assert links == []

    @pytest.mark.asyncio
    async def test_plain_create_zero_links(self, db_session, mocked_hub, mocked_redis) -> None:
        """不带 quicklog_id/change_id 创建 → 两张 link 表零副作用（零回归）。"""
        from app.modules.change.model import ChangeSessionLink, QuicklogSessionLink

        uid = await _create_user(db_session, admin=True)
        await _create_runtime(db_session, uid, provider="claude")

        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt="hi")
        assert result.agent_session.change_id is None

        assert await _count(db_session, QuicklogSessionLink) == 0
        assert await _count(db_session, ChangeSessionLink) == 0


class TestCreateSessionModelSelect:
    """D-002@v1（2026-08-29-usage-by-provider-model / FR-03）：预会话级联首句 model。

    显式 model 优先于供应商派生（config_snapshot 展示口径与下发 config 一致）；
    缺省回落供应商 model（现状零回归）。
    """

    @pytest.mark.asyncio
    async def test_create_with_explicit_model_overrides_provider_derivation(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """llm_provider_id + model 同传：快照 model=显式值（非供应商 glm-4.7 派生）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        lp = await _seed_provider(db_session, uid, model="glm-4.7")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            llm_provider_id=str(lp.id),
            model="glm-4.6",
        )

        s = result.agent_session
        assert s.llm_provider_id == lp.id
        assert s.config_snapshot is not None
        # 显式 model 优先（供应商原配 glm-4.7 不遮蔽选择）。
        assert s.config_snapshot["model"] == "glm-4.6"
        assert s.config_snapshot["provider_name"] == "GLM"

    @pytest.mark.asyncio
    async def test_create_without_model_keeps_provider_derivation(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """不带 model：快照回落供应商 model 派生（现状零回归）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid, provider="claude")
        lp = await _seed_provider(db_session, uid, model="glm-4.7")

        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider=None,
            prompt="hi",
            runtime_id=str(rt.id),
            llm_provider_id=str(lp.id),
        )

        s = result.agent_session
        assert s.config_snapshot is not None
        assert s.config_snapshot["model"] == "glm-4.7"
