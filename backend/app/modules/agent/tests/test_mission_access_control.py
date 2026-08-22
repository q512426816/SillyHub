"""Mission 通用端点（get/cancel）归属校验回归测试（2026-08-21 审查 BE-P0-1/BE-P1-1）。

背景：
- BE-P0-1：``POST /api/missions/{id}/cancel`` 原依赖 ``require_permission``（checker
  声明 ``workspace_id: Path(...)``），路由路径无该参数 → 已认证请求恒 422，取消不可用。
- BE-P1-1：``get_mission`` 无归属校验、``list_missions`` 用 ``require_permission_any``
  使 path 的 workspace_id 不参与鉴权，均可跨 workspace 越权读写。

修复后契约：
- cancel：登录 + 归属校验（anchor/scope 内任一 ws 有 workspace:write，或项目经理/超管）。
- get：归属校验（anchor/scope 内任一 ws 有 task:read，或项目经理/超管）。
- list（workspace/project 维度创建+列表端点）：task-13（D-011）随入口归一会话触发
  一并删除，相关用例已移除；本文件仅守护保留的 get/cancel/dispatch_worker。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi import status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.agent.model import AgentMission
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.workspace.model import Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_user(db_session, *, is_admin: bool = False) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"user-{uid.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name=f"User {uid.hex[:8]}",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    return user


async def _grant_ws_permission(
    db_session, *, user: User, workspace_id: uuid.UUID, permission: str
) -> None:
    """给用户在指定 workspace 授一个含 permission 的角色。"""
    role_id = uuid.uuid4()
    db_session.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    db_session.add(RolePermission(role_id=role_id, permission=permission))
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )


async def _make_mission(db_session, workspace_id: uuid.UUID, *, project_id=None) -> AgentMission:
    mission = AgentMission(
        workspace_id=workspace_id,
        objective="access control test",
        constraints={"mode": "team"},
        project_id=project_id,
    )
    db_session.add(mission)
    await db_session.commit()
    return mission


def _token_for(user: User) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return token


async def _stub_representative_binding(session: AsyncSession, ws_id: uuid.UUID) -> None:
    """给工作区造一条在线机器绑定（ql-20260822-008 派发前在线绑定预检用例）。

    与 test_mcp_tools._stub_representative_binding 同款：daemon_instances(online)
    + daemon_runtimes(online) + workspace_member_runtimes（member 绑定行，命中
    resolve_representative_binding 分支2「任意在线」）。raw SQL 注意 SQLite
    兼容：无 ::json 转换、显式 created_at/updated_at 字符串。
    """
    from sqlalchemy import text

    di_id = uuid.uuid4()
    member_uid = uuid.uuid4()
    ts = "2026-08-22T00:00:00+00:00"
    await session.execute(
        text(
            "INSERT INTO daemon_instances (id, user_id, hostname, server_url, allowed_roots, status, created_at, updated_at)"
            " VALUES (:id, :uid, 'h1', 'http://t', '[\"~/.sillyhub\"]', 'online', :ts, :ts)"
        ),
        {"id": di_id.hex, "uid": member_uid.hex, "ts": ts},
    )
    await session.execute(
        text(
            "INSERT INTO daemon_runtimes (id, user_id, daemon_instance_id, provider, status, created_at, updated_at)"
            " VALUES (:id, :uid, :di, 'claude', 'online', :ts, :ts)"
        ),
        {"id": uuid.uuid4().hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.execute(
        text(
            "INSERT INTO workspace_member_runtimes (workspace_id, user_id, root_path, path_source, daemon_id, shared, created_at, updated_at)"
            " VALUES (:wid, :uid, '/tmp/w', 'manual', :di, false, :ts, :ts)"
        ),
        {"wid": ws_id.hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.commit()


async def test_cancel_mission_not_422_for_admin(client, db_session, tmp_path):
    """BE-P0-1 回归：超管 cancel 不再 422（修复前依赖解析即失败）。"""
    admin = await _make_user(db_session, is_admin=True)
    ws = Workspace(
        id=uuid.uuid4(),
        name="Cancel WS",
        slug=f"cancel-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "cancel"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    mission = await _make_mission(db_session, ws.id)
    await db_session.refresh(admin)

    resp = await client.post(
        f"/api/missions/{mission.id}/cancel",
        headers=_auth(_token_for(admin)),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.text
    assert resp.json()["cancelled_at"] is not None


async def test_cancel_mission_denied_for_outsider(client, db_session, tmp_path):
    """BE-P0-1 归属：对其它 ws 有写权限的用户不能 cancel 本 ws 的 mission（403）。"""
    outsider = await _make_user(db_session)
    ws_mission = Workspace(
        id=uuid.uuid4(),
        name="Mission WS",
        slug=f"mission-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "m"),
        status="active",
    )
    ws_other = Workspace(
        id=uuid.uuid4(),
        name="Other WS",
        slug=f"other-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "o"),
        status="active",
    )
    db_session.add_all([ws_mission, ws_other])
    # 外部用户只在别的 ws 有 workspace:write
    await _grant_ws_permission(
        db_session, user=outsider, workspace_id=ws_other.id, permission="workspace:write"
    )
    await db_session.commit()
    mission = await _make_mission(db_session, ws_mission.id)
    await db_session.refresh(outsider)

    resp = await client.post(
        f"/api/missions/{mission.id}/cancel",
        headers=_auth(_token_for(outsider)),
    )
    assert resp.status_code == status.HTTP_403_FORBIDDEN, resp.text


async def test_cancel_mission_allowed_for_scope_member(client, db_session, tmp_path):
    """BE-P0-1 归属：scope 内 ws 有写权限的成员可以 cancel（跨 ws mission 语义）。"""
    member = await _make_user(db_session)
    anchor = Workspace(
        id=uuid.uuid4(),
        name="Anchor WS",
        slug=f"anchor-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "a"),
        status="active",
    )
    scope_ws = Workspace(
        id=uuid.uuid4(),
        name="Scope WS",
        slug=f"scope-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "s"),
        status="active",
    )
    db_session.add_all([anchor, scope_ws])
    await _grant_ws_permission(
        db_session, user=member, workspace_id=scope_ws.id, permission="workspace:write"
    )
    await db_session.commit()
    mission = await _make_mission(db_session, anchor.id)
    mission.scope_workspace_ids = [str(anchor.id), str(scope_ws.id)]
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(member)

    resp = await client.post(
        f"/api/missions/{mission.id}/cancel",
        headers=_auth(_token_for(member)),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.text


async def test_get_mission_denied_for_outsider(client, db_session, tmp_path):
    """BE-P1-1：对其它 ws 有 task:read 的用户不能读本 ws mission（403）。"""
    outsider = await _make_user(db_session)
    member = await _make_user(db_session)
    ws = Workspace(
        id=uuid.uuid4(),
        name="Get WS",
        slug=f"get-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "g"),
        status="active",
    )
    ws_other = Workspace(
        id=uuid.uuid4(),
        name="Get Other WS",
        slug=f"get-other-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "go"),
        status="active",
    )
    db_session.add_all([ws, ws_other])
    await _grant_ws_permission(
        db_session, user=outsider, workspace_id=ws_other.id, permission="task:read"
    )
    await _grant_ws_permission(db_session, user=member, workspace_id=ws.id, permission="task:read")
    await db_session.commit()
    mission = await _make_mission(db_session, ws.id)
    await db_session.refresh(outsider)
    await db_session.refresh(member)

    outsider_resp = await client.get(
        f"/api/missions/{mission.id}",
        headers=_auth(_token_for(outsider)),
    )
    assert outsider_resp.status_code == status.HTTP_403_FORBIDDEN, outsider_resp.text

    member_resp = await client.get(
        f"/api/missions/{mission.id}",
        headers=_auth(_token_for(member)),
    )
    assert member_resp.status_code == status.HTTP_200_OK, member_resp.text
    assert member_resp.json()["id"] == str(mission.id)


async def test_project_manager_can_cancel_project_mission(client, db_session, tmp_path):
    """BE-P0-1 归属：项目经理（非 anchor/scope 成员）可 cancel 项目维度 mission。"""
    from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember

    manager = await _make_user(db_session)
    ws = Workspace(
        id=uuid.uuid4(),
        name="PM Cancel WS",
        slug=f"pm-cancel-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "pmc"),
        status="active",
    )
    db_session.add(ws)
    project_id = uuid.uuid4()
    db_session.add(
        PpmProjectMaintenance(
            id=project_id,
            project_name="PM Cancel Project",
            project_code="PC001",
            project_status="进行中",
            project_type="研发",
            created_by=manager.id,
        )
    )
    db_session.add(
        PpmProjectMember(
            pm_project_id=project_id,
            user_id=manager.id,
            role_name="项目经理",
        )
    )
    await db_session.commit()
    mission = await _make_mission(db_session, ws.id, project_id=project_id)
    await db_session.refresh(manager)

    resp = await client.post(
        f"/api/missions/{mission.id}/cancel",
        headers=_auth(_token_for(manager)),
    )
    assert resp.status_code == status.HTTP_200_OK, resp.text


async def test_dispatch_worker_cross_ws_denied_for_jwt_user_without_target_permission(
    client, db_session, tmp_path
):
    """BE-P0-2：JWT 用户跨 ws 派发时须对 target ws 有 WORKSPACE_WRITE（403）。"""
    anchor_member = await _make_user(db_session)
    anchor = Workspace(
        id=uuid.uuid4(),
        name="D Anchor WS",
        slug=f"d-anchor-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "da"),
        status="active",
    )
    target_ws = Workspace(
        id=uuid.uuid4(),
        name="D Target WS",
        slug=f"d-target-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "dt"),
        status="active",
    )
    db_session.add_all([anchor, target_ws])
    # 用户只对 anchor 有写权限，对 target 无任何权限
    await _grant_ws_permission(
        db_session, user=anchor_member, workspace_id=anchor.id, permission="workspace:write"
    )
    await db_session.commit()
    mission = await _make_mission(db_session, anchor.id)
    mission.scope_workspace_ids = [str(anchor.id), str(target_ws.id)]
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(anchor_member)

    with patch(
        "app.modules.agent.execution.MissionExecutionService.dispatch_worker",
        new=AsyncMock(return_value=None),
    ):
        resp = await client.post(
            f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
            json={
                "objective": "cross ws dispatch test",
                "target_workspace_id": str(target_ws.id),
            },
            headers=_auth(_token_for(anchor_member)),
        )
    assert resp.status_code == status.HTTP_403_FORBIDDEN, resp.text
    assert "mission_target_forbidden" in resp.text


async def test_dispatch_worker_cross_ws_allowed_for_api_key_channel(client, db_session, tmp_path):
    """BE-P0-2：daemon apiKey 通道（X-API-Key 无 Bearer）跨 ws 派发豁免（主 agent 编排）。"""
    from app.core.config import get_settings
    from app.modules.auth.api_key_service import ApiKeyService

    daemon_owner = await _make_user(db_session)
    anchor = Workspace(
        id=uuid.uuid4(),
        name="K Anchor WS",
        slug=f"k-anchor-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "ka"),
        status="active",
    )
    target_ws = Workspace(
        id=uuid.uuid4(),
        name="K Target WS",
        slug=f"k-target-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "kt"),
        status="active",
    )
    db_session.add_all([anchor, target_ws])
    await _grant_ws_permission(
        db_session, user=daemon_owner, workspace_id=anchor.id, permission="workspace:write"
    )
    await db_session.commit()
    mission = await _make_mission(db_session, anchor.id)
    mission.scope_workspace_ids = [str(anchor.id), str(target_ws.id)]
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(daemon_owner)

    settings = get_settings()
    key_service = ApiKeyService(db_session, settings=settings)
    _, plaintext = await key_service.create(
        user_id=daemon_owner.id, name="test-key", expires_at=None
    )
    await db_session.commit()
    # ql-20260822-008：派发前在线绑定预检——给派发目标（target ws）造在线绑定
    await _stub_representative_binding(db_session, target_ws.id)

    with patch(
        "app.modules.agent.execution.MissionExecutionService.dispatch_worker",
        new=AsyncMock(return_value=None),
    ):
        resp = await client.post(
            f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
            json={
                "objective": "api key channel dispatch test",
                "target_workspace_id": str(target_ws.id),
            },
            headers={"X-API-Key": plaintext},
        )
    assert resp.status_code == status.HTTP_201_CREATED, resp.text
