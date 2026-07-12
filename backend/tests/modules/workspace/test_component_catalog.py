"""ComponentCatalogService 单测（D-001@V1，变更 2026-07-06-component-readonly-split）。

只读组件目录从 projects/*.yaml 派生组件清单，覆盖 platform-managed（daemon-client）
与 server-local fallback 两模式；过滤项目组自身。
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

from app.modules.workspace.component_catalog_service import ComponentCatalogService
from app.modules.workspace.service import WorkspaceService


def _write_project(projects_dir, filename, defn):
    projects_dir.mkdir(parents=True, exist_ok=True)
    (projects_dir / filename).write_text(
        yaml.safe_dump(defn, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _make_ws(tmp_path, name="SillyHub", slug="sillyhub"):
    ws = MagicMock()
    ws.id = uuid.uuid4()
    ws.name = name
    ws.slug = slug
    ws.root_path = str(tmp_path)
    return ws


@pytest.mark.asyncio
async def test_list_components_platform_managed_reads_yaml(tmp_path):
    """platform-managed（daemon-client）模式：从 spec_root/.sillyspec/projects 读 yaml。"""
    ws = _make_ws(tmp_path)
    spec_ws = MagicMock()
    spec_ws.strategy = "platform-managed"
    spec_ws.spec_root = str(tmp_path)

    projects = tmp_path / "projects"
    _write_project(
        projects,
        "backend.yaml",
        {
            "id": "backend",
            "name": "Backend API",
            "type": "component",
            "role": "service",
            "path": "backend",
            "tech_stack": ["Python", "FastAPI"],
        },
    )
    _write_project(
        projects,
        "frontend.yaml",
        {
            "id": "frontend",
            "name": "Frontend App",
            "type": "component",
            "role": "service",
            "path": "frontend",
            "tech_stack": ["TypeScript"],
        },
    )

    service = ComponentCatalogService(MagicMock())
    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        components = await service.list_components(ws.id)

    keys = {c.component_key for c in components}
    assert keys == {"backend", "frontend"}
    backend = next(c for c in components if c.component_key == "backend")
    assert backend.name == "Backend API"
    assert backend.role == "service"
    assert backend.tech_stack == ["Python", "FastAPI"]


@pytest.mark.asyncio
async def test_list_components_excludes_project_group_self(tmp_path):
    """项目组自身 yaml（component_key 命中 ws.name/slug）被过滤。"""
    ws = _make_ws(tmp_path, name="SillyHub", slug="sillyhub")
    spec_ws = MagicMock()
    spec_ws.strategy = "platform-managed"
    spec_ws.spec_root = str(tmp_path)

    projects = tmp_path / "projects"
    _write_project(
        projects,
        "backend.yaml",
        {
            "id": "backend",
            "name": "Backend API",
            "type": "component",
            "path": "backend",
        },
    )
    # 项目组自身（id == slug）
    _write_project(
        projects,
        "sillyhub.yaml",
        {
            "id": "sillyhub",
            "name": "SillyHub",
            "type": "project-group",
            "path": ".",
        },
    )

    service = ComponentCatalogService(MagicMock())
    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        components = await service.list_components(ws.id)

    keys = {c.component_key for c in components}
    assert keys == {"backend"}, f"项目组自身应被过滤, 实际: {keys}"


@pytest.mark.asyncio
async def test_list_components_server_local_fallback(tmp_path):
    """server-local 无 spec_ws：SpecWorkspaceService.get 抛错 → 回退 root_path 读 yaml。"""
    ws = _make_ws(tmp_path)
    # server-local：spec_workspace 不存在，get 抛异常
    projects = tmp_path / "projects"
    _write_project(
        projects,
        "daemon.yaml",
        {
            "id": "daemon",
            "name": "Daemon",
            "type": "component",
            "path": "daemon",
        },
    )

    service = ComponentCatalogService(MagicMock())
    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            side_effect=Exception("no spec_workspace"),
        ),
    ):
        components = await service.list_components(ws.id)

    assert len(components) == 1
    assert components[0].component_key == "daemon"
