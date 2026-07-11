"""Tests for POST /workspaces/scan-generate endpoint."""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_scan_generate_success(client: AsyncClient, auth_headers):
    """正常流程：scan-generate 返回 workspace_id + agent_run_id。"""
    ws_id = uuid.uuid4()
    run_id = uuid.uuid4()

    with patch(
        "app.modules.workspace.service.WorkspaceService.scan_generate",
        new_callable=AsyncMock,
        return_value=(ws_id, run_id),
    ):
        resp = await client.post(
            "/api/workspaces/scan-generate",
            json={"root_path": "/tmp/test-project"},
            headers=auth_headers,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "workspace_id" in data
    assert "agent_run_id" in data
    assert data["workspace_id"] == str(ws_id)
    assert data["agent_run_id"] == str(run_id)


@pytest.mark.asyncio
async def test_scan_generate_path_not_found(client: AsyncClient, auth_headers):
    """root_path 不存在时返回 400。"""
    from app.core.errors import WorkspacePathNotFound

    with patch(
        "app.modules.workspace.service.WorkspaceService.scan_generate",
        new_callable=AsyncMock,
        side_effect=WorkspacePathNotFound(
            "The given root_path does not exist.",
            details={"root_path": "/nonexistent"},
        ),
    ):
        resp = await client.post(
            "/api/workspaces/scan-generate",
            json={"root_path": "/nonexistent"},
            headers=auth_headers,
        )

    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_scan_generate_empty_path(client: AsyncClient, auth_headers):
    """root_path 为空时返回 422。"""
    resp = await client.post(
        "/api/workspaces/scan-generate",
        json={"root_path": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_scan_generate_unauthorized(client: AsyncClient):
    """未认证请求返回 401。"""
    resp = await client.post(
        "/api/workspaces/scan-generate",
        json={"root_path": "/tmp/test"},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_scan_generate_existing_scan_unaffected(client: AsyncClient, auth_headers):
    """新增 scan-generate 端点不影响现有 POST /scan 端点。"""
    with patch(
        "app.modules.workspace.service.WorkspaceService.scan",
        return_value=MagicMock(
            root_path="/tmp/test",
            is_sillyspec=False,
            structure=MagicMock(
                as_dict=lambda: {
                    "has_projects_dir": False,
                    "has_changes_dir": False,
                    "has_docs_dir": False,
                    "has_runtime_dir": False,
                    "has_local_yaml": False,
                    "projects_count": 0,
                    "active_changes_count": 0,
                    "archived_changes_count": 0,
                }
            ),
            warnings=[],
        ),
    ):
        resp = await client.post(
            "/api/workspaces/scan",
            json={"root_path": "/tmp/test"},
            headers=auth_headers,
        )
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_scan_generate_with_daemon_id(client: AsyncClient, auth_headers):
    """scan-generate 接受 daemon_id（daemon-entity-binding 后的稳定绑定键）透传，放行 200。

    回归守护 ql-20260705-003：daemon-entity-binding 后新工作区 daemon_runtime_id 恒 NULL，
    前端改传 daemon_id；schema 接受单 daemon_id 不再要求 daemon_runtime_id。
    D-007@2026-07-10：单一 daemon-client 模式后 ``scan_generate_daemon_client`` 已与
    ``scan_generate`` 合并（task-03 重命名），不再有 path_source 字段。
    """
    ws_id = uuid.uuid4()
    run_id = uuid.uuid4()
    with patch(
        "app.modules.workspace.service.WorkspaceService.scan_generate",
        new_callable=AsyncMock,
        return_value=(ws_id, run_id),
    ):
        resp = await client.post(
            "/api/workspaces/scan-generate",
            json={
                "root_path": "/tmp/test-project",
                "daemon_id": str(uuid.uuid4()),
            },
            headers=auth_headers,
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["workspace_id"] == str(ws_id)
    assert data["agent_run_id"] == str(run_id)
