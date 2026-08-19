"""HTTP-level tests for project-scoped mission endpoints (task-07, 2026-08-19-cross-workspace-team-mission)."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

from fastapi import status

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import PpmProjectWorkspace, Workspace


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setup_project_env(db_session, tmp_path) -> dict:
    """Create project, workspaces, user, and token for project mission tests."""
    # 创建用户（超管）
    admin_id = uuid.uuid4()
    admin = User(
        id=admin_id,
        email=f"admin-{admin_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Admin User",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(admin)

    # 创建项目经理（非超管）
    manager_id = uuid.uuid4()
    manager = User(
        id=manager_id,
        email=f"manager-{manager_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Project Manager",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(manager)

    # 创建项目
    project_id = uuid.uuid4()
    project = PpmProjectMaintenance(
        id=project_id,
        project_name="Test Project",
        project_code="TP001",
        project_status="进行中",
        project_type="研发",
        created_by=manager_id,
    )
    db_session.add(project)

    # 添加项目经理到项目成员
    project_member = PpmProjectMember(
        pm_project_id=project_id,
        user_id=manager_id,
        role_name="项目经理",
    )
    db_session.add(project_member)

    # 创建三个工作区（frontend-code / backend-code / business-doc——逐字对齐
    # 词表真值 WORKSPACE_TYPE_VALUES，workspace-role-type 迁移后存量数据不再有旧值）
    ws_frontend_id = uuid.uuid4()
    ws_frontend = Workspace(
        id=ws_frontend_id,
        name="Frontend Workspace",
        slug=f"frontend-{ws_frontend_id.hex[:8]}",
        root_path=str(tmp_path / "frontend"),
        status="active",
        type="frontend-code",
        description="前端工作区",
    )
    db_session.add(ws_frontend)

    ws_backend_id = uuid.uuid4()
    ws_backend = Workspace(
        id=ws_backend_id,
        name="Backend Workspace",
        slug=f"backend-{ws_backend_id.hex[:8]}",
        root_path=str(tmp_path / "backend"),
        status="active",
        type="backend-code",
        description="后端工作区",
    )
    db_session.add(ws_backend)

    ws_docs_id = uuid.uuid4()
    ws_docs = Workspace(
        id=ws_docs_id,
        name="Docs Workspace",
        slug=f"docs-{ws_docs_id.hex[:8]}",
        root_path=str(tmp_path / "docs"),
        status="active",
        type="business-doc",
        description="文档工作区",
    )
    db_session.add(ws_docs)

    # 绑定工作区到项目
    db_session.add(PpmProjectWorkspace(ppm_project_id=project_id, workspace_id=ws_frontend_id))
    db_session.add(PpmProjectWorkspace(ppm_project_id=project_id, workspace_id=ws_backend_id))
    db_session.add(PpmProjectWorkspace(ppm_project_id=project_id, workspace_id=ws_docs_id))

    # 创建 daemon 实例和 runtime（模拟在线）
    daemon_id = uuid.uuid4()
    daemon = DaemonInstance(
        id=daemon_id,
        user_id=manager_id,
        hostname="test-host",
        server_url="http://localhost:8001",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(daemon)

    runtime_id = uuid.uuid4()
    runtime = DaemonRuntime(
        id=runtime_id,
        daemon_instance_id=daemon_id,
        user_id=manager_id,
        name=f"runtime-{runtime_id.hex[:8]}",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(runtime)

    # 创建 member bindings（backend 和 docs 有 binding，frontend 无）
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws_backend_id,
            user_id=manager_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            root_path=ws_backend.root_path,
            path_source="daemon-client",
        )
    )
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws_docs_id,
            user_id=manager_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            root_path=ws_docs.root_path,
            path_source="daemon-client",
        )
    )
    # frontend 故意不添加 binding，用于测试缺失 binding 场景

    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    admin_token, _ = create_access_token(
        user_id=admin.id,
        email=admin.email,
        is_admin=True,
        settings=settings,
    )
    manager_token, _ = create_access_token(
        user_id=manager.id,
        email=manager.email,
        is_admin=False,
        settings=settings,
    )

    return {
        "project_id": project_id,
        "ws_frontend_id": ws_frontend_id,
        "ws_backend_id": ws_backend_id,
        "ws_docs_id": ws_docs_id,
        "admin_id": admin_id,
        "manager_id": manager_id,
        "admin_token": admin_token,
        "manager_token": manager_token,
    }


async def test_create_project_mission_success(client, db_session, tmp_path):
    """AC-01: POST 创建成功且 project_id / scope_workspace_ids 写入。"""
    refs = await _setup_project_env(db_session, tmp_path)

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        resp = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "设计并落地跨工作区团队执行能力",
                "scope_workspace_ids": [str(refs["ws_backend_id"]), str(refs["ws_docs_id"])],
                "mode": "team",
                "orchestration_mode": "external",  # external 模式不 spawn 主 agent
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    assert data["project_id"] == str(refs["project_id"])
    assert set(data["scope_workspace_ids"]) == {str(refs["ws_backend_id"]), str(refs["ws_docs_id"])}
    assert data["objective"] == "设计并落地跨工作区团队执行能力"


async def test_create_project_mission_scope_out_of_bounds(client, db_session, tmp_path):
    """AC-02: scope 越界（含非项目关联 ws）时 422。"""
    refs = await _setup_project_env(db_session, tmp_path)

    # 创建一个不属于项目的工作区
    other_ws_id = uuid.uuid4()
    other_ws = Workspace(
        id=other_ws_id,
        name="Other Workspace",
        slug=f"other-{other_ws_id.hex[:8]}",
        root_path=str(tmp_path / "other"),
        status="active",
        type="backend-code",
    )
    db_session.add(other_ws)
    await db_session.commit()

    resp = await client.post(
        f"/api/projects/{refs['project_id']}/missions",
        json={
            "objective": "测试",
            "scope_workspace_ids": [str(refs["ws_backend_id"]), str(other_ws_id)],
        },
        headers=_auth(refs["admin_token"]),
    )
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    detail = resp.json()
    # FastAPI validation error format
    assert "detail" in detail or "不在项目关联范围内" in str(detail)


async def test_create_project_mission_anchor_out_of_scope(client, db_session, tmp_path):
    """AC-03: anchor 不在 scope 时 422。"""
    refs = await _setup_project_env(db_session, tmp_path)

    resp = await client.post(
        f"/api/projects/{refs['project_id']}/missions",
        json={
            "objective": "测试",
            "scope_workspace_ids": [str(refs["ws_backend_id"])],
            "anchor_workspace_id": str(refs["ws_frontend_id"]),  # anchor 不在 scope
        },
        headers=_auth(refs["admin_token"]),
    )
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    detail = resp.json()
    assert "detail" in detail or "必须在 scope_workspace_ids 范围内" in str(detail)


async def test_create_project_mission_non_manager_403(client, db_session, tmp_path):
    """AC-04: 非项目经理 403。"""
    refs = await _setup_project_env(db_session, tmp_path)

    # 创建一个普通用户（非项目经理）
    normal_user_id = uuid.uuid4()
    normal_user = User(
        id=normal_user_id,
        email=f"normal-{normal_user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Normal User",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(normal_user)
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=normal_user.id,
        email=normal_user.email,
        is_admin=False,
        settings=settings,
    )

    resp = await client.post(
        f"/api/projects/{refs['project_id']}/missions",
        json={
            "objective": "测试",
            "scope_workspace_ids": [str(refs["ws_backend_id"])],
        },
        headers=_auth(token),
    )
    assert resp.status_code == status.HTTP_403_FORBIDDEN


async def test_create_project_mission_missing_bindings_warning(client, db_session, tmp_path):
    """AC-05: 缺 binding 的 ws 在响应中报清单（可仍创建）。"""
    refs = await _setup_project_env(db_session, tmp_path)

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        resp = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试缺失 binding",
                "scope_workspace_ids": [
                    str(refs["ws_backend_id"]),
                    str(refs["ws_frontend_id"]),
                ],  # frontend 无 binding
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    # 检查 constraints 里是否有 missing_bindings warning
    assert "missing_bindings" in (data.get("constraints") or {})
    missing = data["constraints"]["missing_bindings"]
    assert len(missing) == 1
    assert missing[0]["id"] == str(refs["ws_frontend_id"])
    assert missing[0]["name"] == "Frontend Workspace"


async def test_list_project_missions_includes_summary_fields(client, db_session, tmp_path):
    """AC-06: GET 返回列表含 project_id / scope_workspace_ids / workspace_name / workspace_type。"""
    refs = await _setup_project_env(db_session, tmp_path)

    # 先创建一个 mission
    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        create_resp = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试列表查询",
                "scope_workspace_ids": [str(refs["ws_backend_id"]), str(refs["ws_docs_id"])],
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert create_resp.status_code == status.HTTP_201_CREATED

    # 查询列表
    list_resp = await client.get(
        f"/api/projects/{refs['project_id']}/missions",
        headers=_auth(refs["admin_token"]),
    )
    assert list_resp.status_code == status.HTTP_200_OK
    missions = list_resp.json()
    assert len(missions) == 1

    mission = missions[0]
    assert mission["project_id"] == str(refs["project_id"])
    assert set(mission["scope_workspace_ids"]) == {
        str(refs["ws_backend_id"]),
        str(refs["ws_docs_id"]),
    }
    # workspace_name 和 workspace_type 是概要字段（anchor 的）
    assert (
        mission["workspace_name"] == "Backend Workspace"
    )  # anchor 默认取 backend（type=backend-code 优先，词表真值）
    assert mission["workspace_type"] == "backend-code"


async def test_create_project_mission_anchor_defaults_to_backend(client, db_session, tmp_path):
    """anchor 缺省时：type=backend-code 优先否则 scope 第一个（design §7.1）。"""
    refs = await _setup_project_env(db_session, tmp_path)

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        # scope 含 backend，应选 backend 做 anchor
        resp = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试 anchor 默认 backend",
                "scope_workspace_ids": [
                    str(refs["ws_docs_id"]),
                    str(refs["ws_backend_id"]),
                ],  # docs 在前，backend 在后
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    # workspace_id 即 anchor，应指向 backend（type=backend-code 优先）
    assert data["workspace_id"] == str(refs["ws_backend_id"])

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        # scope 不含 backend，应选第一个
        resp2 = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试 anchor 默认第一个",
                "scope_workspace_ids": [
                    str(refs["ws_docs_id"]),
                    str(refs["ws_frontend_id"]),
                ],  # 无 backend
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp2.status_code == status.HTTP_201_CREATED
    data2 = resp2.json()
    # 应选 scope 第一个（docs）
    assert data2["workspace_id"] == str(refs["ws_docs_id"])


async def test_create_project_mission_anchor_prefers_backend_code_type(
    client, db_session, tmp_path
):
    """task-07 review 追补：anchor 缺省的 backend 优先必须比对词表真值 backend-code。

    回归背景：router 曾比对 ``w.type == "backend"``——该值只是旧值归一化的来源
    key（YAML_TYPE_NORMALIZE_MAP），存量数据里已不存在，比对永不命中，backend
    优先沦为死代码、anchor 恒取 scope 第一个。本用例自建工作区钉死正确语义：
    - scope 含 type=backend-code 工作区（不在 scope 首位）→ anchor 取它；
    - scope 不含 backend-code → anchor 取 scope 第一个。
    """
    refs = await _setup_project_env(db_session, tmp_path)

    # 自建两个工作区：非 backend-code 在前、backend-code 在后（不依赖共享 fixture 顺序）
    ws_fe2_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_fe2_id,
            name="Extra Frontend Workspace",
            slug=f"fe2-{ws_fe2_id.hex[:8]}",
            root_path=str(tmp_path / "fe2"),
            status="active",
            type="frontend-code",
        )
    )
    ws_be2_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_be2_id,
            name="Extra Backend Workspace",
            slug=f"be2-{ws_be2_id.hex[:8]}",
            root_path=str(tmp_path / "be2"),
            status="active",
            type="backend-code",
        )
    )
    db_session.add(PpmProjectWorkspace(ppm_project_id=refs["project_id"], workspace_id=ws_fe2_id))
    db_session.add(PpmProjectWorkspace(ppm_project_id=refs["project_id"], workspace_id=ws_be2_id))
    await db_session.commit()

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        # 不带 anchor_workspace_id：backend-code 即使不在 scope 首位也应被选为 anchor
        resp = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试 anchor 缺省 backend-code 优先",
                "scope_workspace_ids": [str(ws_fe2_id), str(ws_be2_id)],
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    assert data["workspace_id"] == str(ws_be2_id)  # anchor = backend-code 那个

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        # backend-code 不在 scope：取 scope 第一个
        resp2 = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "测试 anchor 缺省取第一个",
                "scope_workspace_ids": [str(ws_fe2_id)],
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp2.status_code == status.HTTP_201_CREATED
    data2 = resp2.json()
    assert data2["workspace_id"] == str(ws_fe2_id)  # anchor = scope 第一个


async def test_create_project_mission_scope_must_be_nonempty(client, db_session, tmp_path):
    """scope_workspace_ids 必填 ≥1（空列表 422）。"""
    refs = await _setup_project_env(db_session, tmp_path)

    resp = await client.post(
        f"/api/projects/{refs['project_id']}/missions",
        json={
            "objective": "测试",
            "scope_workspace_ids": [],  # 空列表
        },
        headers=_auth(refs["admin_token"]),
    )
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    detail = resp.json()
    assert "detail" in detail or "必须指定 scope_workspace_ids" in str(detail)


async def test_list_project_missions_filters_by_project_id(client, db_session, tmp_path):
    """GET 列表按 project_id 过滤（不同 project 的 mission 不混）。"""
    refs = await _setup_project_env(db_session, tmp_path)

    # 创建第二个项目
    project2_id = uuid.uuid4()
    project2 = PpmProjectMaintenance(
        id=project2_id,
        project_name="Project 2",
        project_code="P002",
        project_status="进行中",
        project_type="研发",
        created_by=refs["admin_id"],
    )
    db_session.add(project2)
    await db_session.commit()

    # 为项目 1 创建 mission
    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        resp1 = await client.post(
            f"/api/projects/{refs['project_id']}/missions",
            json={
                "objective": "Project 1 Mission",
                "scope_workspace_ids": [str(refs["ws_backend_id"])],
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp1.status_code == status.HTTP_201_CREATED

    # 为项目 2 创建 mission（用 backend workspace，通过 member binding 关联）
    db_session.add(
        PpmProjectWorkspace(ppm_project_id=project2_id, workspace_id=refs["ws_backend_id"])
    )
    await db_session.commit()
    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        resp2 = await client.post(
            f"/api/projects/{project2_id}/missions",
            json={
                "objective": "Project 2 Mission",
                "scope_workspace_ids": [str(refs["ws_backend_id"])],
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp2.status_code == status.HTTP_201_CREATED

    # 查项目 1 的列表
    list1 = await client.get(
        f"/api/projects/{refs['project_id']}/missions",
        headers=_auth(refs["admin_token"]),
    )
    assert list1.status_code == status.HTTP_200_OK
    missions1 = list1.json()
    assert len(missions1) == 1
    assert missions1[0]["project_id"] == str(refs["project_id"])

    # 查项目 2 的列表
    list2 = await client.get(
        f"/api/projects/{project2_id}/missions",
        headers=_auth(refs["admin_token"]),
    )
    assert list2.status_code == status.HTTP_200_OK
    missions2 = list2.json()
    assert len(missions2) == 1
    assert missions2[0]["project_id"] == str(project2_id)


async def test_workspace_mission_create_zero_regression(client, db_session, tmp_path):
    """存量 /workspaces/{id}/missions 零回归（不传 scope → 单 ws 行为不变）。"""
    refs = await _setup_project_env(db_session, tmp_path)

    with patch(
        "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
        new=AsyncMock(return_value=uuid.uuid4()),
    ):
        # 不传 anchor_workspace_id / scope_workspace_ids，保持原逻辑
        resp = await client.post(
            f"/api/workspaces/{refs['ws_backend_id']}/missions",
            json={
                "objective": "单工作区 mission",
                "mode": "team",
                "orchestration_mode": "external",
            },
            headers=_auth(refs["admin_token"]),
        )
    assert resp.status_code == status.HTTP_201_CREATED
    data = resp.json()
    # project_id 应为 None（单 ws mission 不强制挂项目）
    assert data["project_id"] is None
    # scope_workspace_ids 应为 None（单 ws）
    assert data["scope_workspace_ids"] is None
    assert data["workspace_id"] == str(refs["ws_backend_id"])
