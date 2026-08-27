"""Tests for daemon-borrow resolver + shared-daemon query (task-05).

Change 2026-07-25-daemon-borrow-for-business task-05 / D-002@v1 / D-008@v1 /
FR-04。Change 2026-08-28-daemon-agent-share task-06：借用数据源切 grants
（design §5 Phase 2.3 / §9 语义等价红线），seed 从「binding shared=True」改为
「workspace grant enabled 行」+ actor 成员资格（grants 版含成员 EXISTS 防御）。

覆盖：
  - ``resolve_shared_daemon_for_borrow``（queries.py 薄壳 → 委托 grants 版）：
    enabled grant + 非空 daemon_instance_id + granted_by ≠ actor + daemon online +
    actor 是 grantee 工作区成员 + provider 解析，各边界。
  - ``_resolve_borrowed_or_own_runtime``（agent/borrow_resolver.py）：
    * 自有在线 daemon → (runtime, False, None) 零回归（即便有 DAEMON_BORROW 也走自有）
    * 无自有 + enabled grant + DAEMON_BORROW → (runtime, True, lender)
    * 无 DAEMON_BORROW → (None, False, None)
    * lender 离线 / 无 grant → (None, False, None)
    * 三重校验顺序：权限 → enabled(grant) → online（permission 不通过时即便
      grant+online 也不返回；permission 通过但 grant/online 缺失则 None）

测试范式照抄 ``test_member_runtimes.py``：hermetic per-test SQLite，手工 seed
role/user/workspace/daemon/grant。RBAC 走真实 ``has_permission``（permission_cache
Redis 故障时降级查 DB，conftest 无需 mock Redis）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.borrow_resolver import _resolve_borrowed_or_own_runtime
from app.modules.workspace.member_runtimes.queries import resolve_shared_daemon_for_borrow

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# Seed helpers — mirror test_member_runtimes.py fixtures (inline 闭包形式，
# 避免 fixture 依赖图复杂化；每个 test 独立 db_session）。
# ────────────────────────────────────────────────────────────────────────────


async def _seed_role(db_session: AsyncSession, key: str, perms: list[str]) -> uuid.UUID:
    """种一个角色 + 权限列表，返回 role_id。"""
    from app.modules.auth.model import Role, RolePermission

    role = Role(
        id=uuid.uuid4(),
        key=key,
        name=key,
        description=key,
        is_system=True,
    )
    db_session.add(role)
    await db_session.flush()
    for p in perms:
        db_session.add(RolePermission(role_id=role.id, permission=p))
    await db_session.commit()
    return role.id


async def _seed_user(db_session: AsyncSession, *, is_platform_admin: bool = False) -> uuid.UUID:
    """种一个 active 用户，返回 user_id。"""
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="U",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


async def _seed_workspace(db_session: AsyncSession, tmp_path: Any) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="W",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws.id


async def _grant_role(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
) -> None:
    """给用户在工作空间授一个角色（user_workspace_roles 行）。"""
    from app.modules.auth.model import UserWorkspaceRole

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
    daemon_id: uuid.UUID | None = None,
) -> uuid.UUID:
    """种一个 daemon_instance（默认 online），返回 daemon_id。"""
    from app.modules.daemon.model import DaemonInstance

    inst = DaemonInstance(
        id=daemon_id or uuid.uuid4(),
        user_id=owner_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        server_url="http://test.local",
        status=status,
    )
    db_session.add(inst)
    await db_session.commit()
    return inst.id


async def _seed_runtime(
    db_session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    owner_id: uuid.UUID,
    provider: str = "claude",
    status: str = "online",
) -> uuid.UUID:
    """在 daemon 下种一个 provider runtime（默认 claude/online），返回 runtime_id。"""
    from app.modules.daemon.model import DaemonRuntime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        user_id=owner_id,
        provider=provider,
        status=status,
    )
    db_session.add(rt)
    await db_session.commit()
    return rt.id


async def _seed_binding(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID | None,
    shared: bool = False,
    root_path: str = "/home/u/repo",
) -> None:
    """种一条 workspace_member_runtimes 绑定行（自有路径 seed 用；借用命中不再读它）。"""
    from app.modules.workspace.member_runtimes.model import (
        WorkspaceMemberRuntime,
    )

    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=shared,
            root_path=root_path,
            path_source="daemon_client",
        )
    )
    await db_session.commit()


# ────────────────────────────────────────────────────────────────────────────
# task-06 新增 seed：grants 授权行 + actor 成员资格（数据源切 grants 后的命中前提）
# ────────────────────────────────────────────────────────────────────────────


async def _seed_grant(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    lender_user_id: uuid.UUID,
    daemon_id: uuid.UUID,
    enabled: bool = True,
) -> uuid.UUID:
    """种一条 workspace 类型 grants 授权行（task-06 借用数据源）。返回 grant_id。"""
    from app.modules.daemon.grants.model import DaemonRuntimeGrant

    grant = DaemonRuntimeGrant(
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=workspace_id,
        granted_by_user_id=lender_user_id,
        enabled=enabled,
    )
    db_session.add(grant)
    await db_session.commit()
    return grant.id


async def _make_actor_member(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
) -> None:
    """给 actor 种纯成员资格（无任何权限的角色）——满足 grants 版成员 EXISTS 防御。

    查询级测试不查权限，只要求 actor 在 grantee 工作区有 user_workspace_roles 行。
    """
    member_role = await _seed_role(db_session, "member", [])
    await _grant_role(db_session, workspace_id=workspace_id, user_id=user_id, role_id=member_role)


# ────────────────────────────────────────────────────────────────────────────
# resolve_shared_daemon_for_borrow — 薄壳委托 grants 版（纯查询语义，不查权限）
# ────────────────────────────────────────────────────────────────────────────


async def test_resolve_shared_happy_path_returns_runtime_dict(db_session, tmp_path) -> None:
    """enabled grant + online + actor 成员 + provider 匹配 → runtime dict（user_id=lender）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender, status="online")
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="claude")
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude")

    assert rt is not None
    # 薄壳保留原返回 shape（grants 版 ORM 对象转 dict，不加 grant_id——契约不变）。
    assert set(rt.keys()) == {
        "id",
        "user_id",
        "provider",
        "status",
        "daemon_instance_id",
    }
    assert rt["provider"] == "claude"
    assert rt["status"] == "online"
    # runtime.user_id 即 lender（daemon 归属人）。薄壳返回 ORM 属性（uuid.UUID），
    # 调用方的 uuid.UUID(str(...)) 归一化兼容 uuid.UUID 与 hex 字符串两种类型。
    assert uuid.UUID(str(rt["user_id"])) == lender
    assert uuid.UUID(str(rt["daemon_instance_id"])) == did


async def test_resolve_shared_returns_none_when_grant_disabled(db_session, tmp_path) -> None:
    """grant enabled=False（撤销语义，↔原 shared=False）→ 不命中，返回 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(
        db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did, enabled=False
    )

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_no_grant(db_session, tmp_path) -> None:
    """无任何 grant 行（↔原未开共享 binding）→ 返回 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_excludes_actor_own_binding(db_session, tmp_path) -> None:
    """granted_by ≠ actor 过滤：actor 自己开的 grant 不应被自己「借用」。"""
    ws = await _seed_workspace(db_session, tmp_path)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=actor)
    await _seed_runtime(db_session, daemon_id=did, owner_id=actor)
    # actor 自己开了共享 grant——但仍不应被借用查询命中（防御自有路径已处理）。
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=actor, daemon_id=did)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_actor_not_member(db_session, tmp_path) -> None:
    """task-06 成员防御：enabled grant + online 但 actor 非 grantee 工作区成员 → None。

    grants 版较原 SQL 的加固点（task-02）：grantee_id=workspace_id 之外另加
    actor 成员资格 EXISTS（design §5 Phase 2.3「同工作区成员」逐条等价 + 防御）。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)  # 无 user_workspace_roles 行
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_daemon_offline(db_session, tmp_path) -> None:
    """lender 的 daemon 离线 → JOIN daemon_instances.status='online' 过滤掉。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender, status="offline")
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_daemon_id_null(db_session, tmp_path) -> None:
    """binding.shared=True 但 daemon_id IS NULL（未迁移行）→ 无 grant 行可命中 → None。

    grants 授权对象是 daemon 机器：daemon_id NULL 的 binding 在迁移（task-01）与
    开关双写（task-06 service）两侧都不生成 grant（design §5 Phase 1 / Grill B-03）。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=None, shared=True)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_no_matching_provider(db_session, tmp_path) -> None:
    """daemon online 但无匹配 provider 的 runtime → provider 解析 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender)
    # lender daemon 只挂了 codex，actor 要借 claude。
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="codex")
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_provider_none_returns_any_online_runtime(
    db_session, tmp_path
) -> None:
    """provider=None → 取 lender daemon 上任意在线 runtime（最近心跳优先）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="codex")
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, None)
    assert rt is not None
    assert rt["provider"] == "codex"


async def test_resolve_shared_prefers_one_lender_when_multiple_shared(db_session, tmp_path) -> None:
    """多个 lender 都有 enabled grant + online → LIMIT 1 命中其一（确定性返回 dict）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender_a = await _seed_user(db_session)
    lender_b = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _make_actor_member(db_session, workspace_id=ws, user_id=actor)
    did_a = await _seed_daemon(db_session, owner_id=lender_a)
    did_b = await _seed_daemon(db_session, owner_id=lender_b)
    await _seed_runtime(db_session, daemon_id=did_a, owner_id=lender_a)
    await _seed_runtime(db_session, daemon_id=did_b, owner_id=lender_b)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender_a, daemon_id=did_a)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender_b, daemon_id=did_b)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude")
    assert rt is not None
    # 命中的 lender 必须不是 actor 自己（归一化比较）。
    assert uuid.UUID(str(rt["user_id"])) in {lender_a, lender_b}


# ────────────────────────────────────────────────────────────────────────────
# _resolve_borrowed_or_own_runtime — helper（4 路 resolver 统一入口）
# ────────────────────────────────────────────────────────────────────────────


async def _seed_borrow_role(db_session: AsyncSession) -> uuid.UUID:
    """business_member 角色：TASK_RUN_AGENT + DAEMON_BORROW + WORKSPACE_READ。"""
    from app.modules.auth.permissions import Permission

    return await _seed_role(
        db_session,
        "business_member",
        [
            Permission.TASK_RUN_AGENT.value,
            Permission.DAEMON_BORROW.value,
            Permission.WORKSPACE_READ.value,
        ],
    )


async def test_helper_own_online_daemon_zero_regression(db_session, tmp_path) -> None:
    """AC1：actor 有自有在线 daemon → 返回自有 runtime，borrowed=False（零回归原路径）。

    即便 actor 同时持有 DAEMON_BORROW，自有路径仍优先（不借用自己的 daemon）。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=actor)
    await _seed_runtime(db_session, daemon_id=did, owner_id=actor, provider="claude")
    await _seed_binding(db_session, workspace_id=ws, user_id=actor, daemon_id=did, shared=False)

    rt, borrowed, lender = await _resolve_borrowed_or_own_runtime(db_session, ws, actor, "claude")

    assert rt is not None
    assert rt["provider"] == "claude"
    assert borrowed is False
    assert lender is None


async def test_helper_own_daemon_without_borrow_permission(db_session, tmp_path) -> None:
    """AC1 变体：developer 角色自有 daemon，无 DAEMON_BORROW → 仍走自有（零回归）。"""
    from app.modules.auth.permissions import Permission

    ws = await _seed_workspace(db_session, tmp_path)
    actor = await _seed_user(db_session)
    dev_role = await _seed_role(
        db_session,
        "developer",
        [Permission.TASK_RUN_AGENT.value, Permission.WORKSPACE_READ.value],
    )
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=dev_role)
    did = await _seed_daemon(db_session, owner_id=actor)
    await _seed_runtime(db_session, daemon_id=did, owner_id=actor)
    await _seed_binding(db_session, workspace_id=ws, user_id=actor, daemon_id=did, shared=False)

    rt, borrowed, lender = await _resolve_borrowed_or_own_runtime(db_session, ws, actor, "claude")

    assert rt is not None
    assert borrowed is False
    assert lender is None


async def test_helper_borrow_when_no_own_with_permission(db_session, tmp_path) -> None:
    """AC2：actor 无自有 + 有 enabled grant + 有 DAEMON_BORROW → 借用 runtime+lender。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="claude")
    grant_id = await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is not None
    assert borrowed is True
    assert lender_uid is not None
    assert str(lender_uid) == str(lender)
    # 借来的 runtime 属于 lender daemon（归一化比较，SQLite hex vs PG uuid）。
    assert uuid.UUID(str(rt["user_id"])) == lender
    # task-06：借用 dict 纯增量携带 _grant_id 传输键（str，对齐 placement
    # _stamp_borrowed_flag transport-only 约定，_pop_grant_id 消费写审计 grant_id）。
    assert rt.get("_grant_id") == str(grant_id)


async def test_helper_returns_none_without_borrow_permission(db_session, tmp_path) -> None:
    """AC3：无 DAEMON_BORROW → 即便有 enabled grant + online lender 也不借用。"""
    from app.modules.auth.permissions import Permission

    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    # viewer 角色只读，无 DAEMON_BORROW（但成员资格存在——隔离权限闸单变量）。
    viewer_role = await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=viewer_role)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender = await _resolve_borrowed_or_own_runtime(db_session, ws, actor, "claude")

    assert rt is None
    assert borrowed is False
    assert lender is None


async def test_helper_returns_none_when_lender_offline(db_session, tmp_path) -> None:
    """AC3 变体：有 DAEMON_BORROW 但 lender daemon 离线 → 无可借用，返回 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=lender, status="offline")
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_returns_none_when_no_grant_row(db_session, tmp_path) -> None:
    """AC3 变体：有 DAEMON_BORROW 但无任何 grant 行（↔原无 shared binding）→ None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_actor_with_no_role_at_all_returns_none(db_session, tmp_path) -> None:
    """无任何角色（无 user_workspace_roles 行）→ 权限闸/成员防御均挡 → None。

    也覆盖 actor user_id 在 users 表存在但无任何授权的边界。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)  # 无角色 → 无成员资格
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_platform_admin_can_borrow(db_session, tmp_path) -> None:
    """platform_admin 短路 has_permission → 无 business_member 角色也能借用。

    task-06：grants 版查询含成员 EXISTS 防御——admin 也须是 grantee 工作区成员
    （本用例验证的是权限闸短路，不是成员豁免，故给 admin 种成员资格）。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    admin = await _seed_user(db_session, is_platform_admin=True)
    await _make_actor_member(db_session, workspace_id=ws, user_id=admin)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, admin, "claude"
    )

    assert rt is not None
    assert borrowed is True
    assert lender_uid is not None
    assert str(lender_uid) == str(lender)


# ────────────────────────────────────────────────────────────────────────────
# 三重校验顺序：权限 → enabled(grant) → online
# ────────────────────────────────────────────────────────────────────────────


async def test_triple_gate_order_permission_first(db_session, tmp_path) -> None:
    """权限闸优先：enabled grant + online 都满足但无 DAEMON_BORROW → 不借用（None）。

    证明权限检查在 grant/online 查询之前生效（即便数据层有候选也不返回）。
    本用例与 test_helper_returns_none_without_borrow_permission 同语义，此处显式
    归到「三重顺序」断言组，便于回归定位。
    """
    from app.modules.auth.permissions import Permission

    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    viewer_role = await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=viewer_role)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_grant(db_session, workspace_id=ws, lender_user_id=lender, daemon_id=did)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None and borrowed is False and lender_uid is None


async def test_triple_gate_order_enabled_before_online(db_session, tmp_path) -> None:
    """enabled 闸在 online 之前：有权限 + enabled grant 但 lender 离线 → None（不会
    回退到其他 online 但无 grant 的 daemon）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender_grant_offline = await _seed_user(db_session)
    lender_online_no_grant = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)

    # lender A：有 enabled grant 但 daemon 离线。
    did_a = await _seed_daemon(db_session, owner_id=lender_grant_offline, status="offline")
    await _seed_runtime(db_session, daemon_id=did_a, owner_id=lender_grant_offline)
    await _seed_grant(
        db_session, workspace_id=ws, lender_user_id=lender_grant_offline, daemon_id=did_a
    )
    # lender B：online 但没有 grant。
    did_b = await _seed_daemon(db_session, owner_id=lender_online_no_grant)
    await _seed_runtime(db_session, daemon_id=did_b, owner_id=lender_online_no_grant)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    # 离线的 granted daemon 不命中；online 但无 grant 的也不会被偷借 → None。
    assert rt is None and borrowed is False and lender_uid is None
