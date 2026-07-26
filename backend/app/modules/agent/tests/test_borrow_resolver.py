"""Tests for daemon-borrow resolver + shared-daemon query (task-05).

Change 2026-07-25-daemon-borrow-for-business task-05 / D-002@v1 / D-008@v1 /
FR-04。

覆盖：
  - ``resolve_shared_daemon_for_borrow``（queries.py）：shared + daemon_id 非空 +
    user_id &lt;&gt; actor + daemon online + provider 解析，5 类边界。
  - ``_resolve_borrowed_or_own_runtime``（agent/borrow_resolver.py）：
    * 自有在线 daemon → (runtime, False, None) 零回归（即便有 DAEMON_BORROW 也走自有）
    * 无自有 + shared + DAEMON_BORROW → (runtime, True, lender)
    * 无 DAEMON_BORROW → (None, False, None)
    * lender 离线 / 无 shared → (None, False, None)
    * 三重校验顺序：权限 → shared → online（permission 不通过时即便 shared+online
      也不返回；permission 通过但 shared/online 缺失则 None）

测试范式照抄 ``test_member_runtimes.py``：hermetic per-test SQLite，手工 seed
role/user/workspace/daemon/binding。RBAC 走真实 ``has_permission``（permission_cache
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
    """种一条 workspace_member_runtimes 绑定行。"""
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
# resolve_shared_daemon_for_borrow — 纯查询语义（不查权限）
# ────────────────────────────────────────────────────────────────────────────


async def test_resolve_shared_happy_path_returns_runtime_dict(db_session, tmp_path) -> None:
    """shared=True + online + provider 匹配 → 返回 runtime dict（user_id=lender）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=lender, status="online")
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="claude")
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude")

    assert rt is not None
    assert set(rt.keys()) == {
        "id",
        "user_id",
        "provider",
        "status",
        "daemon_instance_id",
    }
    assert rt["provider"] == "claude"
    assert rt["status"] == "online"
    # runtime.user_id 即 lender（daemon 归属人）。SQLite 原生 SQL 返回 CHAR(32) hex、
    # PG 返回 uuid.UUID；统一用 uuid.UUID(str(...)) 归一比较（生产代码同此规范化）。
    assert uuid.UUID(str(rt["user_id"])) == lender
    assert uuid.UUID(str(rt["daemon_instance_id"])) == did


async def test_resolve_shared_returns_none_when_not_shared(db_session, tmp_path) -> None:
    """shared=False（默认）→ 不命中借用查询，返回 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=False)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_excludes_actor_own_binding(db_session, tmp_path) -> None:
    """user_id &lt;&gt; actor 过滤：actor 自己的 shared binding 不应被自己「借用」。"""
    ws = await _seed_workspace(db_session, tmp_path)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=actor)
    await _seed_runtime(db_session, daemon_id=did, owner_id=actor)
    # actor 自己 shared 了——但仍不应被借用查询命中（防御自有路径已处理）。
    await _seed_binding(db_session, workspace_id=ws, user_id=actor, daemon_id=did, shared=True)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_daemon_offline(db_session, tmp_path) -> None:
    """lender 的 daemon 离线 → JOIN daemon_instances.status='online' 过滤掉。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=lender, status="offline")
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_daemon_id_null(db_session, tmp_path) -> None:
    """binding.shared=True 但 daemon_id IS NULL（未迁移行）→ 过滤掉。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=None, shared=True)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_returns_none_when_no_matching_provider(db_session, tmp_path) -> None:
    """daemon online 但无匹配 provider 的 runtime → query_runtime_by_daemon_and_provider None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=lender)
    # lender daemon 只挂了 codex，actor 要借 claude。
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="codex")
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    assert await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude") is None


async def test_resolve_shared_provider_none_returns_any_online_runtime(
    db_session, tmp_path
) -> None:
    """provider=None → 取 lender daemon 上任意在线 runtime（最近心跳优先）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="codex")
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, None)
    assert rt is not None
    assert rt["provider"] == "codex"


async def test_resolve_shared_prefers_one_lender_when_multiple_shared(db_session, tmp_path) -> None:
    """多个 lender 都 shared+online → LIMIT 1 命中其一（确定性返回 dict）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender_a = await _seed_user(db_session)
    lender_b = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    did_a = await _seed_daemon(db_session, owner_id=lender_a)
    did_b = await _seed_daemon(db_session, owner_id=lender_b)
    await _seed_runtime(db_session, daemon_id=did_a, owner_id=lender_a)
    await _seed_runtime(db_session, daemon_id=did_b, owner_id=lender_b)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender_a, daemon_id=did_a, shared=True)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender_b, daemon_id=did_b, shared=True)

    rt = await resolve_shared_daemon_for_borrow(db_session, ws, actor, "claude")
    assert rt is not None
    # 命中的 lender 必须不是 actor 自己（归一化比较，SQLite hex vs PG uuid）。
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
    """AC2：actor 无自有 + 有共享在线 + 有 DAEMON_BORROW → 借用 runtime+lender。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender, provider="claude")
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is not None
    assert borrowed is True
    assert lender_uid is not None
    assert str(lender_uid) == str(lender)
    # 借来的 runtime 属于 lender daemon（归一化比较，SQLite hex vs PG uuid）。
    assert uuid.UUID(str(rt["user_id"])) == lender


async def test_helper_returns_none_without_borrow_permission(db_session, tmp_path) -> None:
    """AC3：无 DAEMON_BORROW → 即便有 shared+online lender 也不借用，返回 None。"""
    from app.modules.auth.permissions import Permission

    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    # viewer 角色只读，无 DAEMON_BORROW。
    viewer_role = await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=viewer_role)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

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
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_returns_none_when_no_shared_binding(db_session, tmp_path) -> None:
    """AC3 变体：有 DAEMON_BORROW 但无任何 shared binding → 返回 None。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    # lender 绑了但没 shared。
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=False)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_actor_with_no_role_at_all_returns_none(db_session, tmp_path) -> None:
    """无任何角色（无 user_workspace_roles 行）→ has_permission False → None。

    也覆盖 actor user_id 在 users 表存在但无任何授权的边界。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)  # 无角色
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None
    assert borrowed is False
    assert lender_uid is None


async def test_helper_platform_admin_can_borrow(db_session, tmp_path) -> None:
    """platform_admin 短路 has_permission → 即便无 business_member 角色也能借用。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    admin = await _seed_user(db_session, is_platform_admin=True)
    did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=did, owner_id=lender)
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, admin, "claude"
    )

    assert rt is not None
    assert borrowed is True
    assert lender_uid is not None
    assert str(lender_uid) == str(lender)


# ────────────────────────────────────────────────────────────────────────────
# 三重校验顺序：权限 → shared → online
# ────────────────────────────────────────────────────────────────────────────


async def test_triple_gate_order_permission_first(db_session, tmp_path) -> None:
    """权限闸优先：shared+online 都满足但无 DAEMON_BORROW → 不借用（None）。

    证明权限检查在 shared/online 查询之前生效（即便数据层有候选也不返回）。
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
    await _seed_binding(db_session, workspace_id=ws, user_id=lender, daemon_id=did, shared=True)

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    assert rt is None and borrowed is False and lender_uid is None


async def test_triple_gate_order_shared_before_online(db_session, tmp_path) -> None:
    """shared 闸在 online 之前：有权限 + shared=True 但 lender 离线 → None（不会
    回退到其他 online 但未 shared 的 daemon）。"""
    ws = await _seed_workspace(db_session, tmp_path)
    lender_shared_offline = await _seed_user(db_session)
    lender_unshared_online = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    role_id = await _seed_borrow_role(db_session)
    await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)

    # lender A：shared=True 但 daemon 离线。
    did_a = await _seed_daemon(db_session, owner_id=lender_shared_offline, status="offline")
    await _seed_runtime(db_session, daemon_id=did_a, owner_id=lender_shared_offline)
    await _seed_binding(
        db_session,
        workspace_id=ws,
        user_id=lender_shared_offline,
        daemon_id=did_a,
        shared=True,
    )
    # lender B：online 但没 shared。
    did_b = await _seed_daemon(db_session, owner_id=lender_unshared_online)
    await _seed_runtime(db_session, daemon_id=did_b, owner_id=lender_unshared_online)
    await _seed_binding(
        db_session,
        workspace_id=ws,
        user_id=lender_unshared_online,
        daemon_id=did_b,
        shared=False,
    )

    rt, borrowed, lender_uid = await _resolve_borrowed_or_own_runtime(
        db_session, ws, actor, "claude"
    )

    # 离线的 shared daemon 不命中；online 但未 shared 的也不会被偷借 → None。
    assert rt is None and borrowed is False and lender_uid is None
