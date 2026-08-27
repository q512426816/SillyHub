"""grants 授权查询三件套单测（task-02 / design §5 Phase 2 / §7）。

授权矩阵全覆盖：

- ``authorize_pinned_runtime``：platform grant 直传钉定 D-012@v1 封堵
  （命中 → None）/ 停用 / 档案悬空；workspace grant 命中 / 非成员 / 无权限 /
  停用 / 离线 / lender 本人；runtime 不存在；owner 短路归调用方（函数侧
  None）；workspace_id=None 全工作区权限聚合形态。
- ``list_machines_shared_to_me``：字段装配（别名回退/lender 显示名/来源工作区/
  在线/runtime 明细 task-13——多 provider/离线/空/他机隔离）、D-013@v1 权限
  过滤（成员无 daemon:borrow 不返回、多工作区仅持权限处可见）、非成员隔离、
  停用与 platform 行不列、离线机器仍列（online=False）、同工作区多角色不放大行。
- ``resolve_granted_daemon_for_borrow``：命中三元组、provider 两形态（严格匹配 /
  None 取最近心跳）、停用 / 离线 / 非本人排除 / 非成员，及与原
  ``resolve_shared_daemon_for_borrow`` 同 fixture 等价性（额外携带 grant_id）。

fixture 说明：目录 conftest 的 selected-metadata 只含 3 表，本文件需要更大
FK 闭包（角色/成员/档案/旧 binding 表），故模块级 ``db_engine``/``db_session``
就近遮蔽（pytest 模块 fixture 优先于 conftest），闭包按 FK 目标自动传递闭包
计算，模型演进免手工维护清单。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import MetaData
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.models.base import BaseModel

# ── 仅注册用的模型 import（FK 闭包目标表，缺注册则 create_all 解析失败）──────
# user_roles（has_permission 平台路径回退查库）/ llm_providers 与 tool_policies
# （agent_profiles 的 FK 目标）。测试进程内注册顺序不定，显式 import 保证确定性。
from app.modules.admin import model as _admin_model  # noqa: F401
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import (
    Role,
    RolePermission,
    User,
    UserWorkspaceRole,
)
from app.modules.auth.permissions import Permission
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.grants.queries import (
    SharedMachineRuntimeRow,
    authorize_pinned_runtime,
    list_machines_shared_to_me,
    resolve_granted_daemon_for_borrow,
)
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.llm_provider import model as _llm_provider_model  # noqa: F401
from app.modules.tool_gateway import tool_policy as _tool_policy_model  # noqa: F401
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.member_runtimes.queries import (
    resolve_shared_daemon_for_borrow,
)
from app.modules.workspace.model import Workspace

# ── 模块级 fixture（遮蔽目录 conftest 的 3 表 selected-metadata）──────────────


def _closure_metadata(*roots: str) -> MetaData:
    """从根表出发沿 ForeignKey 目标做传递闭包，物化一份最小建表 metadata。

    比 conftest 的手写清单多覆盖：roles/role_permissions/user_workspace_roles
    （成员资格与权限）、user_roles（has_permission 平台路径回退查库）、
    agent_profiles（platform 分支档案存在 join）、workspace_member_runtimes
    （等价性对照的旧数据源）及其 FK 目标（workspaces/llm_providers/
    tool_policies 等）。目标表名用 ``fk.target_fullname`` 字符串解析，不触
    ``fk.column`` 惰性解析（目标模块未注册时解析会抛 NoReferencedTableError）。
    """
    full = BaseModel.metadata
    seen: set[str] = set()
    stack: list[str] = list(roots)
    while stack:
        name = stack.pop()
        if name in seen or name not in full.tables:
            continue
        seen.add(name)
        for fk in full.tables[name].foreign_keys:
            target = fk.target_fullname.split(".")[0]
            if target not in seen:
                stack.append(target)
    meta = MetaData()
    for name in sorted(seen):
        full.tables[name].to_metadata(meta)
    return meta


@pytest.fixture()
async def db_engine():
    """每测试独立 in-memory SQLite（闭包建表），隔离且快。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    meta = _closure_metadata(
        "daemon_runtime_grants",
        "daemon_runtimes",
        "user_workspace_roles",
        "role_permissions",
        "user_roles",
        "agent_profiles",
        "workspace_member_runtimes",
    )
    async with engine.begin() as conn:
        await conn.run_sync(meta.create_all)
    try:
        yield engine
    finally:
        await engine.dispose()


@pytest.fixture()
async def db_session(db_engine: Any) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(bind=db_engine, class_=AsyncSession, expire_on_commit=False)
    async with factory() as session:
        yield session


# ── Seed helpers（范式照抄 agent/tests/test_borrow_resolver.py）───────────────


async def _seed_user(
    db_session: AsyncSession, *, display_name: str = "U", is_platform_admin: bool = False
) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name=display_name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _seed_role(db_session: AsyncSession, key: str, perms: list[str]) -> Role:
    role = Role(id=uuid.uuid4(), key=key, name=key, description=key, is_system=True)
    db_session.add(role)
    await db_session.flush()
    for p in perms:
        db_session.add(RolePermission(role_id=role.id, permission=p))
    await db_session.commit()
    return role


async def _seed_workspace(db_session: AsyncSession, name: str = "W") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws


async def _grant_role(
    db_session: AsyncSession, *, workspace_id: uuid.UUID, user_id: uuid.UUID, role_id: uuid.UUID
) -> None:
    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _seed_daemon(
    db_session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    status: str = "online",
    display_alias: str | None = None,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        display_alias=display_alias,
        server_url="http://test.local",
        status=status,
    )
    db_session.add(inst)
    await db_session.commit()
    return inst


async def _seed_runtime(
    db_session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    owner_id: uuid.UUID,
    provider: str = "claude",
    status: str = "online",
    last_heartbeat_at: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        user_id=owner_id,
        provider=provider,
        status=status,
        last_heartbeat_at=last_heartbeat_at,
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _seed_grant(
    db_session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    granted_by: uuid.UUID,
    grantee_id: uuid.UUID | None = None,
    grantee_type: str = "workspace",
    enabled: bool = True,
    agent_profile_id: uuid.UUID | None = None,
    source_workspace_id: uuid.UUID | None = None,
    pinned_runtime_id: uuid.UUID | None = None,
    writable_dir: str | None = None,
) -> DaemonRuntimeGrant:
    grant = DaemonRuntimeGrant(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        grantee_type=grantee_type,
        grantee_id=grantee_id,
        granted_by_user_id=granted_by,
        agent_profile_id=agent_profile_id,
        source_workspace_id=source_workspace_id,
        pinned_runtime_id=pinned_runtime_id,
        writable_dir=writable_dir,
        enabled=enabled,
    )
    db_session.add(grant)
    await db_session.commit()
    return grant


async def _seed_agent_profile(
    db_session: AsyncSession, *, name: str = "共享智能体"
) -> AgentProfile:
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name,
        provider="claude",
        visibility=AgentProfileVisibility.PLATFORM,
    )
    db_session.add(profile)
    await db_session.commit()
    return profile


async def _seed_binding(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID | None,
    shared: bool = False,
) -> None:
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=shared,
            root_path=f"/home/u/repo-{uuid.uuid4().hex[:6]}",
            path_source="daemon_client",
        )
    )
    await db_session.commit()


async def _seed_borrow_role(db_session: AsyncSession) -> Role:
    """business_member 角色：DAEMON_BORROW（借用权限闸的最小集合）。"""
    return await _seed_role(db_session, "business_member", [Permission.DAEMON_BORROW.value])


# ── authorize_pinned_runtime —— 授权矩阵 ────────────────────────────────────


async def test_grants_empty_table_zero_behavior(db_session) -> None:
    """grants 空表零行为兼容（design §9）：authorize None / list 空 / borrow None。"""
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    did = await _seed_daemon(db_session, owner_id=actor.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=actor.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )
    assert await list_machines_shared_to_me(db_session, actor_user_id=actor.id) == []
    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_authorize_runtime_not_found_returns_none(db_session) -> None:
    """runtime 不存在 → None（调用方维持 404，不泄露存在性）。"""
    actor = await _seed_user(db_session)
    assert (
        await authorize_pinned_runtime(
            db_session,
            actor_user_id=actor.id,
            runtime_id=uuid.uuid4(),
            workspace_id=None,
        )
        is None
    )


async def test_authorize_platform_grant_direct_pin_returns_none(db_session) -> None:
    """D-012@v1（验收审查 gap-2）：platform grant 的 pinned runtime 直传钉定
    → None（调用方 404 封堵）。

    直接钉定（不带共享档案）会绕过 task-05 强制（cwd/写约束/工具集）；共享
    runtime 唯一入口=task-05 档案检测（其下发 pinned_skip_owner_check=True
    不经 authorize，不受影响）。原「命中放行 + 绑定四元组」语义由本翻转收口。
    """
    admin = await _seed_user(db_session, display_name="Admin")
    actor = await _seed_user(db_session, display_name="Actor")
    profile = await _seed_agent_profile(db_session)
    src_ws = await _seed_workspace(db_session, name="源码区")
    did = await _seed_daemon(db_session, owner_id=admin.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=admin.id)
    await _seed_grant(
        db_session,
        daemon_id=did.id,
        granted_by=admin.id,
        grantee_type="platform",
        grantee_id=None,
        agent_profile_id=profile.id,
        source_workspace_id=src_ws.id,
        pinned_runtime_id=rt.id,
        writable_dir="/srv/share/out",
    )

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=None
        )
        is None
    )


async def test_authorize_platform_grant_disabled_falls_through(db_session) -> None:
    """platform grant 停用（enabled=False）→ 不命中；无 workspace grant 兜底 → None。"""
    admin = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    profile = await _seed_agent_profile(db_session)
    src_ws = await _seed_workspace(db_session)
    did = await _seed_daemon(db_session, owner_id=admin.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=admin.id)
    await _seed_grant(
        db_session,
        daemon_id=did.id,
        granted_by=admin.id,
        grantee_type="platform",
        grantee_id=None,
        enabled=False,
        agent_profile_id=profile.id,
        source_workspace_id=src_ws.id,
        pinned_runtime_id=rt.id,
        writable_dir="/srv/share/out",
    )

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=None
        )
        is None
    )


async def test_authorize_platform_grant_dangling_profile_skipped(db_session) -> None:
    """档案被物理删除的悬空 platform grant 不放行（join 档案存在）。"""
    admin = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    src_ws = await _seed_workspace(db_session)
    did = await _seed_daemon(db_session, owner_id=admin.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=admin.id)
    await _seed_grant(
        db_session,
        daemon_id=did.id,
        granted_by=admin.id,
        grantee_type="platform",
        grantee_id=None,
        # 档案 id 指向不存在的行（未 seed agent_profiles）。
        agent_profile_id=uuid.uuid4(),
        source_workspace_id=src_ws.id,
        pinned_runtime_id=rt.id,
        writable_dir="/srv/share/out",
    )

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=None
        )
        is None
    )


async def test_authorize_workspace_grant_hit(db_session) -> None:
    """workspace 命中：成员 + DAEMON_BORROW + enabled + 在线 + 非本人。"""
    lender = await _seed_user(db_session, display_name="Lender")
    actor = await _seed_user(db_session, display_name="Actor")
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    grant = await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    result = await authorize_pinned_runtime(
        db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
    )
    assert result is not None
    assert result.kind == "workspace_grant"
    assert result.grant_id == grant.id
    assert result.lender_user_id == lender.id
    # workspace 分支不携带 platform 绑定（钉定绑定仅 platform 语义）。
    assert result.platform_binding is None


async def test_authorize_workspace_grant_requires_membership(db_session) -> None:
    """actor 非 grantee 工作区成员 → None（即便持全局借用权限）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    # actor 不在该工作区授任何角色（非成员）。
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_workspace_grant_requires_borrow_permission(db_session) -> None:
    """actor 是成员但角色无 daemon:borrow → None（权限不足不得命中）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    plain = await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=plain.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_workspace_grant_disabled_returns_none(db_session) -> None:
    """grant 停用（enabled=False，撤销软开关）→ None。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(
        db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id, enabled=False
    )

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_workspace_grant_daemon_offline_returns_none(db_session) -> None:
    """lender 机器离线 → workspace 分支不放行（在线是授权条件之一）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id, status="offline")
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_workspace_grant_excludes_lender_self(db_session) -> None:
    """granted_by == actor（lender 本人钉自己共享的机器）→ None——owner 短路归
    调用方，本人路径不应经 workspace grant 放行（永不「借用」自己）。"""
    lender = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=lender.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=lender.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_owner_runtime_returns_none_owner_is_caller_side(db_session) -> None:
    """actor 自有 runtime 且无任何 grant → None：owner 短路在调用方（task-03
    先判 owner 走原路径），本函数 kind 不含 owner。"""
    owner = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=owner.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=owner.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=owner.id)

    assert (
        await authorize_pinned_runtime(
            db_session, actor_user_id=owner.id, runtime_id=rt.id, workspace_id=ws.id
        )
        is None
    )


async def test_authorize_workspace_grant_with_none_workspace_id(db_session) -> None:
    """workspace_id=None（无工作区上下文的会话）：成员资格仍按 grantee 工作区
    判，权限走 has_permission 全工作区聚合 → 命中。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    grant = await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    result = await authorize_pinned_runtime(
        db_session, actor_user_id=actor.id, runtime_id=rt.id, workspace_id=None
    )
    assert result is not None
    assert result.kind == "workspace_grant"
    assert result.grant_id == grant.id


# ── list_machines_shared_to_me —— 列表装配与隔离 ────────────────────────────


async def test_list_machines_fields(db_session) -> None:
    """字段装配（成员 + daemon:borrow 双条件命中，D-013）：machine_id=机器 id、
    display_name 别名回退 hostname、lender 显示名、来源工作区、online 状态；
    runtimes 明细（task-13）多 provider 如实携带（provider 升序、离线 runtime
    保留并标 online=False）。"""
    lender = await _seed_user(db_session, display_name="张三")
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_role(
        db_session,
        "member",
        [Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
    )
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id, display_alias="主力机")
    rt_claude = await _seed_runtime(
        db_session, daemon_id=did.id, owner_id=lender.id, provider="claude"
    )
    rt_codex = await _seed_runtime(
        db_session, daemon_id=did.id, owner_id=lender.id, provider="codex", status="offline"
    )
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    assert len(rows) == 1
    row = rows[0]
    assert row.machine_id == did.id
    assert row.display_name == "主力机"
    assert row.lender_display_name == "张三"
    assert row.source_workspace_id == ws.id
    assert row.online is True
    # task-13：runtime 明细三字段——runtime_id/provider/online（口径=runtime.status）。
    assert row.runtimes == (
        SharedMachineRuntimeRow(runtime_id=rt_claude.id, provider="claude", online=True),
        SharedMachineRuntimeRow(runtime_id=rt_codex.id, provider="codex", online=False),
    )


async def test_list_machines_requires_borrow_permission(db_session) -> None:
    """D-013@v1（验收审查 gap-1）：成员资格之外还需 daemon:borrow——仅持
    WORKSPACE_READ 的成员不返回任何行；同用户在两个工作区仅一处持权限时，
    只看得到该工作区的 grant 行（逐 grantee 工作区判定，权限不跨区放大）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws_a = await _seed_workspace(db_session, name="A")
    ws_b = await _seed_workspace(db_session, name="B")
    plain = await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])
    borrow = await _seed_borrow_role(db_session)
    # A 区：成员但仅 WORKSPACE_READ（无 daemon:borrow）。
    await _grant_role(db_session, workspace_id=ws_a.id, user_id=actor.id, role_id=plain.id)
    # B 区：成员且持 daemon:borrow。
    await _grant_role(db_session, workspace_id=ws_b.id, user_id=actor.id, role_id=borrow.id)
    did_a = await _seed_daemon(db_session, owner_id=lender.id)
    did_b = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did_a.id, granted_by=lender.id, grantee_id=ws_a.id)
    await _seed_grant(db_session, daemon_id=did_b.id, granted_by=lender.id, grantee_id=ws_b.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    assert [row.machine_id for row in rows] == [did_b.id], "仅持 daemon:borrow 的 B 区行可见"


async def test_list_machines_runtimes_empty_and_machine_scoped(db_session) -> None:
    """task-13：0-runtime 共享机器 runtimes=()；多机共享时明细按机器归属不互串。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_role(
        db_session,
        "member",
        [Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
    )
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    bare_did = await _seed_daemon(db_session, owner_id=lender.id)
    rich_did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=rich_did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=bare_did.id, granted_by=lender.id, grantee_id=ws.id)
    await _seed_grant(db_session, daemon_id=rich_did.id, granted_by=lender.id, grantee_id=ws.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    by_machine = {row.machine_id: row.runtimes for row in rows}
    assert set(by_machine) == {bare_did.id, rich_did.id}
    assert by_machine[bare_did.id] == (), "0-runtime 机器明细为空 tuple"
    assert by_machine[rich_did.id] == (
        SharedMachineRuntimeRow(runtime_id=rt.id, provider="claude", online=True),
    )


async def test_list_machines_alias_fallback_to_hostname(db_session) -> None:
    """display_alias 为空 → display_name 回退 hostname。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_role(
        db_session,
        "member",
        [Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
    )
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    assert len(rows) == 1
    assert rows[0].display_name == did.hostname


async def test_list_machines_isolation_non_member_sees_nothing(db_session) -> None:
    """隔离：非 grantee 工作区成员的用户看不到任何行；停用与 platform 行也不列。"""
    lender = await _seed_user(db_session)
    member = await _seed_user(db_session)
    outsider = await _seed_user(db_session)
    admin = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    other_ws = await _seed_workspace(db_session, name="Other")
    role = await _seed_role(
        db_session,
        "member",
        [Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
    )
    await _grant_role(db_session, workspace_id=ws.id, user_id=member.id, role_id=role.id)
    # outsider 只在另一个无关工作区（非 grant 的 grantee 工作区）。
    await _grant_role(db_session, workspace_id=other_ws.id, user_id=outsider.id, role_id=role.id)

    did = await _seed_daemon(db_session, owner_id=lender.id)
    profile = await _seed_agent_profile(db_session)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)
    # 停用行（已撤销，另一 lender 的行——唯一约束四列含 granted_by，同键不并存；
    # 现实中撤销是翻同一行的 enabled，此处用第二 lender 模拟「历史停用行」）。
    await _seed_grant(
        db_session, daemon_id=did.id, granted_by=admin.id, grantee_id=ws.id, enabled=False
    )
    # platform 行（grantee_id=NULL）不进机器列表。
    await _seed_grant(
        db_session,
        daemon_id=did.id,
        granted_by=admin.id,
        grantee_type="platform",
        grantee_id=None,
        agent_profile_id=profile.id,
        pinned_runtime_id=uuid.uuid4(),
    )

    member_rows = await list_machines_shared_to_me(db_session, actor_user_id=member.id)
    assert len(member_rows) == 1, "仅 1 行生效 workspace grant；停用/platform 行不列"
    assert await list_machines_shared_to_me(db_session, actor_user_id=outsider.id) == []


async def test_list_machines_offline_flagged_not_filtered(db_session) -> None:
    """离线机器仍在列表（online=False，前端据此禁用「会话」操作）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_role(
        db_session,
        "member",
        [Permission.WORKSPACE_READ.value, Permission.DAEMON_BORROW.value],
    )
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    online_did = await _seed_daemon(db_session, owner_id=lender.id)
    offline_did = await _seed_daemon(db_session, owner_id=lender.id, status="offline")
    await _seed_grant(db_session, daemon_id=online_did.id, granted_by=lender.id, grantee_id=ws.id)
    await _seed_grant(db_session, daemon_id=offline_did.id, granted_by=lender.id, grantee_id=ws.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    by_machine = {row.machine_id: row.online for row in rows}
    assert by_machine == {online_did.id: True, offline_did.id: False}


async def test_list_machines_multi_role_no_row_amplification(db_session) -> None:
    """同工作区多角色（复合 PK 允许多行 user_workspace_roles）不放大 grant 行
    ——EXISTS 成员判定去重。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role_a = await _seed_role(db_session, "dev", [Permission.WORKSPACE_READ.value])
    role_b = await _seed_role(db_session, "biz", [Permission.DAEMON_BORROW.value])
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role_a.id)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role_b.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    rows = await list_machines_shared_to_me(db_session, actor_user_id=actor.id)
    assert len(rows) == 1


# ── resolve_granted_daemon_for_borrow —— 借用解析与等价性 ───────────────────


async def test_borrow_resolve_hit_returns_triple(db_session) -> None:
    """命中：enabled + 在线 + 成员 + 非本人 + provider 匹配 → 三元组。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id, provider="claude")
    grant = await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    result = await resolve_granted_daemon_for_borrow(
        db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
    )
    assert result is not None
    assert result.runtime.id == rt.id
    assert result.lender_user_id == lender.id
    assert result.grant_id == grant.id


async def test_borrow_resolve_provider_none_picks_latest_heartbeat(db_session) -> None:
    """provider=None → 取该机器最近心跳的在线 runtime（两形态之一）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    base = datetime.now(UTC)
    old_rt = await _seed_runtime(
        db_session,
        daemon_id=did.id,
        owner_id=lender.id,
        provider="claude",
        last_heartbeat_at=base - timedelta(minutes=10),
    )
    new_rt = await _seed_runtime(
        db_session,
        daemon_id=did.id,
        owner_id=lender.id,
        provider="codex",
        last_heartbeat_at=base,
    )
    assert old_rt.id != new_rt.id
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    result = await resolve_granted_daemon_for_borrow(
        db_session, actor_user_id=actor.id, workspace_id=ws.id, provider=None
    )
    assert result is not None
    assert result.runtime.id == new_rt.id, "最近心跳的 codex runtime 优先"


async def test_borrow_resolve_provider_mismatch_returns_none(db_session) -> None:
    """provider 严格匹配：机器只有 codex 而 actor 要 claude → None。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id, provider="codex")
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_borrow_resolve_disabled_returns_none(db_session) -> None:
    """停用 grant（enabled=False）→ None。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(
        db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id, enabled=False
    )

    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_borrow_resolve_offline_returns_none(db_session) -> None:
    """lender 机器离线 → None。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id, status="offline")
    await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_borrow_resolve_excludes_lender_self(db_session) -> None:
    """granted_by == actor（自己共享的机器）→ None（永不借自己）。"""
    lender = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=lender.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=lender.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_borrow_resolve_requires_membership(db_session) -> None:
    """actor 非 grantee 工作区成员 → None（成员防御加固）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    # actor 不是 ws 成员（无 user_workspace_roles 行）。
    did = await _seed_daemon(db_session, owner_id=lender.id)
    await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id)
    await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    assert (
        await resolve_granted_daemon_for_borrow(
            db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
        )
        is None
    )


async def test_borrow_resolve_equivalent_to_legacy_shared_query(db_session) -> None:
    """等价性（task 卡 acceptance）：同一组 fixture 下与原
    resolve_shared_daemon_for_borrow 命中同一 runtime 与 lender，且额外携带
    grant_id（binding shared 行与 grants 行双seed，模拟迁移后并存数据）。"""
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session)
    role = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws.id, user_id=actor.id, role_id=role.id)
    did = await _seed_daemon(db_session, owner_id=lender.id)
    rt = await _seed_runtime(db_session, daemon_id=did.id, owner_id=lender.id, provider="claude")
    # 旧数据源：binding shared=TRUE（迁移前形态）。
    await _seed_binding(
        db_session, workspace_id=ws.id, user_id=lender.id, daemon_id=did.id, shared=True
    )
    # 新数据源：迁移生成的等价 grant 行（design §5 Phase 1 存量迁移）。
    grant = await _seed_grant(db_session, daemon_id=did.id, granted_by=lender.id, grantee_id=ws.id)

    legacy = await resolve_shared_daemon_for_borrow(db_session, ws.id, actor.id, "claude")
    assert legacy is not None
    new = await resolve_granted_daemon_for_borrow(
        db_session, actor_user_id=actor.id, workspace_id=ws.id, provider="claude"
    )
    assert new is not None
    # 同一 runtime / 同一 lender（SQLite hex vs PG uuid 归一化比较）。
    assert uuid.UUID(str(legacy["id"])) == new.runtime.id == rt.id
    assert uuid.UUID(str(legacy["user_id"])) == new.lender_user_id
    # 增量：grants 版额外携带 grant_id。
    assert new.grant_id == grant.id
