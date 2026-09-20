"""工作区平台级授权三口径测试（2026-09-20-workspace-member-visibility task-04 反转版）。

语义历史：
  - ql-20260917-007-7cec（旧义，已废止）：平台级角色（``user_roles``）含
    ``workspace:read`` 的非成员对全部工作区「列表全量可见 + 详情可达 + 收通知」
    ——当时为对齐 ``has_permission`` 段 2 的平台穿透语义，把列表分支放宽。
  - 2026-09-20-workspace-member-visibility（D-003@v1：判定链单点收紧 + 三触点
    对齐；task-01/02/03 落地实现 72c22616/f1aa2afe/0c611260，本文件 task-04
    反转断言）：工作区上下文内平台级**业务**权限不再穿透，只有 ``platform:admin``
    权限或 ``is_platform_admin`` 标志可越成员门槛。本文件语义随之整体反转，
    守住 R-01（三处口径再次割裂）。

新技术义（FR-01~04）三口径——列表可见 / 详情可访问（has_permission）/
通知收件人（``list_user_ids_with_permission``）：
  - 非成员 + 平台级 ``workspace:read`` → 空列表（total=0/items=[]）、
    ``GET /api/workspaces/{id}`` 403、不在收件人集合（反转本体）；
  - 平台级 ``platform:admin`` 持有者 → 全量列表 + 详情可达 + 在收件人集合（对照）；
  - ``is_platform_admin`` 标志 → 同上（对照）；
  - 工作区成员（``user_workspace_roles`` 持 workspace:read）→ 仅成员工作区
    可见/可访问/收件（对照，收紧不影响真实成员路径）；
  - 平台级角色不含读权限（如仅 ``ppm:task:read``）→ 入口
    ``require_permission_any(WORKSPACE_READ)`` 403（护栏：口径不扩大成
    「任何平台角色都全量」）；
  - 无任何角色的普通用户 → 入口 403（既有语义回归）；
  - 三口径一致性（AC-07）：对代表性用户（非成员平台级业务权限者 / 成员 /
    platform:admin 持有者 / is_platform_admin 标志）逐一断言
    列表可见集 == ``has_permission`` 可访问集 == 通知收件集。

不 mock service —— 真实建 Workspace/Role/UserRole 行跑真实 SQL
（SQLite in-memory，方言无关断言），与 test_permission_scope.py /
test_rbac_workspace_scope.py 同范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission, list_user_ids_with_permission
from app.modules.workspace.model import Workspace


async def _make_user(
    db_session: AsyncSession, *, is_platform_admin: bool = False
) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"plat-grant-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _make_workspace(db_session: AsyncSession, *, name: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"{name}-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{name}-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _grant_platform_role(
    db_session: AsyncSession, *, user: User, permissions: list[str]
) -> None:
    """给 user 绑一个平台级角色（user_roles），带指定权限集。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"plat_{uuid.uuid4().hex[:8]}",
        name="Platform Role",
        description="test platform-level role",
    )
    db_session.add(role)
    for perm in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=perm))
    db_session.add(UserRole(user_id=user.id, role_id=role.id))
    await db_session.commit()


async def _grant_workspace_role(
    db_session: AsyncSession,
    *,
    user: User,
    workspace: Workspace,
    permissions: list[str],
) -> None:
    """给 user 在指定工作区内授一个角色（user_workspace_roles）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"ws_reader_{uuid.uuid4().hex[:6]}",
        name="Workspace Reader",
        description="test workspace-scoped role",
    )
    db_session.add(role)
    for perm in permissions:
        db_session.add(RolePermission(role_id=role.id, permission=perm))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _recipients(db_session: AsyncSession, *, workspace_id: uuid.UUID) -> set[uuid.UUID]:
    """通知广播收件人集合（list_user_ids_with_permission 段 1/2/3 之并）。"""
    return set(
        await list_user_ids_with_permission(
            db_session,
            workspace_id=workspace_id,
            permission=Permission.WORKSPACE_READ,
        )
    )


async def test_platform_workspace_read_nonmember_blocked_three_calibers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """反转本体：非成员 + 平台级 workspace:read → 三口径全空。

    入口 ``require_permission_any`` 平台直通保留（FR-05）→ 列表请求 200，
    但行级 ``allowed_workspace_ids`` 为空 → total=0/items=[]（FR-01）；
    详情走 ``require_permission``（workspace 上下文）→ 403（FR-02）；
    收件人段 2 仅匹配 platform:admin → 不含该用户（FR-03）。
    """
    ws_a = await _make_workspace(db_session, name="pg-block-a")
    ws_b = await _make_workspace(db_session, name="pg-block-b")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["workspace:read"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 0, body
    assert body["items"] == [], body

    for ws in (ws_a, ws_b):
        detail = await client.get(
            f"/api/workspaces/{ws.id}", headers={"Authorization": f"Bearer {token}"}
        )
        assert detail.status_code == 403, (ws.slug, detail.text)
        assert user.id not in await _recipients(db_session, workspace_id=ws.id)


async def test_platform_admin_perm_full_access_three_calibers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """对照：平台级 platform:admin 持有者 → 全量列表 + 详情可达 + 在收件人集合。"""
    ws_a = await _make_workspace(db_session, name="pg-adminperm-a")
    ws_b = await _make_workspace(db_session, name="pg-adminperm-b")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["platform:admin"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert {str(ws_a.id), str(ws_b.id)} <= ids

    for ws in (ws_a, ws_b):
        detail = await client.get(
            f"/api/workspaces/{ws.id}", headers={"Authorization": f"Bearer {token}"}
        )
        assert detail.status_code == 200, (ws.slug, detail.text)
        assert user.id in await _recipients(db_session, workspace_id=ws.id)


async def test_is_platform_admin_flag_full_access_three_calibers(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """对照：is_platform_admin 标志（无任何角色行）→ 全量列表 + 详情可达 + 在收件人集合。"""
    ws_a = await _make_workspace(db_session, name="pg-flag-a")
    ws_b = await _make_workspace(db_session, name="pg-flag-b")
    user, token = await _make_user(db_session, is_platform_admin=True)

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert {str(ws_a.id), str(ws_b.id)} <= ids

    for ws in (ws_a, ws_b):
        detail = await client.get(
            f"/api/workspaces/{ws.id}", headers={"Authorization": f"Bearer {token}"}
        )
        assert detail.status_code == 200, (ws.slug, detail.text)
        assert user.id in await _recipients(db_session, workspace_id=ws.id)


async def test_workspace_scoped_member_limited_to_own_workspace(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """对照：工作区级 workspace:read 成员 → 仅成员工作区可见/可访问/收件
    （allowed_workspace_ids 分支回归护栏，收紧不影响真实成员路径）。"""
    own_ws = await _make_workspace(db_session, name="pg-own")
    outsider_ws = await _make_workspace(db_session, name="pg-ws-outsider")
    user, token = await _make_user(db_session)
    await _grant_workspace_role(
        db_session, user=user, workspace=own_ws, permissions=["workspace:read"]
    )

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200, resp.text
    ids = {item["id"] for item in resp.json()["items"]}
    assert str(own_ws.id) in ids
    assert str(outsider_ws.id) not in ids

    own_detail = await client.get(
        f"/api/workspaces/{own_ws.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert own_detail.status_code == 200, own_detail.text
    outsider_detail = await client.get(
        f"/api/workspaces/{outsider_ws.id}", headers={"Authorization": f"Bearer {token}"}
    )
    assert outsider_detail.status_code == 403, outsider_detail.text

    assert user.id in await _recipients(db_session, workspace_id=own_ws.id)
    assert user.id not in await _recipients(db_session, workspace_id=outsider_ws.id)


async def test_three_caliber_consistency(client: AsyncClient, db_session: AsyncSession) -> None:
    """三口径一致性（AC-07，防 R-01 复发）：同一夹具下，对代表性用户逐一断言

        列表可见集 == has_permission(WORKSPACE_READ) 可访问集 == 通知收件集

    且等于各自预期成员制集合——既锁三处口径互相对齐，也锁成员制语义本体，
    防三口径「一致地一起漂移」。
    """
    ws_a = await _make_workspace(db_session, name="cons-a")
    ws_b = await _make_workspace(db_session, name="cons-b")
    all_ws = [ws_a, ws_b]

    biz_user, biz_token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=biz_user, permissions=["workspace:read"])

    member_user, member_token = await _make_user(db_session)
    await _grant_workspace_role(
        db_session, user=member_user, workspace=ws_a, permissions=["workspace:read"]
    )

    perm_admin_user, perm_admin_token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=perm_admin_user, permissions=["platform:admin"])

    flag_admin_user, flag_admin_token = await _make_user(db_session, is_platform_admin=True)

    full = {ws_a.id, ws_b.id}
    roster: list[tuple[str, User, str, set[uuid.UUID]]] = [
        ("非成员+平台级业务权限者", biz_user, biz_token, set()),
        ("工作区成员", member_user, member_token, {ws_a.id}),
        ("平台级platform:admin持有者", perm_admin_user, perm_admin_token, full),
        ("is_platform_admin标志", flag_admin_user, flag_admin_token, full),
    ]
    for label, user, token, expected in roster:
        resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200, (label, resp.text)
        visible = {uuid.UUID(item["id"]) for item in resp.json()["items"]}

        accessible = {
            ws.id
            for ws in all_ws
            if await has_permission(
                db_session,
                user=user,
                permission=Permission.WORKSPACE_READ,
                workspace_id=ws.id,
            )
        }
        recipient = {
            ws.id for ws in all_ws if user.id in await _recipients(db_session, workspace_id=ws.id)
        }

        assert visible == expected, (label, "列表可见集", visible, expected)
        assert accessible == expected, (label, "has_permission可访问集", accessible, expected)
        assert recipient == expected, (label, "通知收件集", recipient, expected)


async def test_platform_role_without_read_perm_rejected_at_door(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """平台级角色不含读权限（如仅 ppm 权限）→ 被入口
    ``require_permission_any(WORKSPACE_READ)`` 挡 403（依赖层先于列表分支，
    既有语义回归——口径不扩大成「任何平台角色都全量」）。"""
    await _make_workspace(db_session, name="pg-ppm-outsider")
    user, token = await _make_user(db_session)
    await _grant_platform_role(db_session, user=user, permissions=["ppm:task:read"])

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text


async def test_user_without_any_role_gets_403(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """无任何角色的普通用户 → 403（既有语义回归，入口依赖未变）。"""
    await _make_workspace(db_session, name="pg-no-role")
    _, token = await _make_user(db_session)

    resp = await client.get("/api/workspaces", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 403, resp.text
