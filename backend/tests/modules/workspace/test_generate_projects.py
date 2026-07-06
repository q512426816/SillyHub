"""WorkspaceService.generate_projects 一级粒度测试（D-002/D-003/D-004@V1，变更 2026-07-06-component-readonly-split）。

generate_projects 改为按 module path 的顶级目录分组（backend/frontend/daemon/...），
只产一级子项目 yaml；不再生成 relations 段（D-004 砍关系层）；末尾也不再 reparse
落子组件（D-003，组件不再是 workspace 行）。
"""

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import yaml

from app.modules.workspace.service import WorkspaceService


def _write_module_map(docs_dir, module_map):
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / "_module-map.yaml").write_text(
        yaml.safe_dump(module_map, allow_unicode=True, sort_keys=False),
        encoding="utf-8",
    )


def _load_generated_projects(projects_dir):
    return {
        f.stem: yaml.safe_load(f.read_text(encoding="utf-8")) for f in projects_dir.glob("*.yaml")
    }


def _make_ws(tmp_path, name="TestProj"):
    ws = MagicMock()
    ws.id = uuid.uuid4()
    ws.name = name
    ws.root_path = str(tmp_path)
    return ws


def _make_spec_ws(tmp_path):
    spec_ws = MagicMock()
    spec_ws.strategy = "platform-managed"
    spec_ws.spec_root = str(tmp_path)
    return spec_ws


@pytest.mark.asyncio
async def test_generate_projects_groups_by_top_level_dir(tmp_path):
    """模块级路径归入对应一级子项目：backend/* → backend，frontend/* → frontend。"""
    ws = _make_ws(tmp_path)
    spec_ws = _make_spec_ws(tmp_path)
    module_map = {
        "modules": {
            # backend 子树两个模块 → 归入 "backend" 一级组件
            "backend-agent": {"paths": [str(tmp_path / "backend" / "agent")]},
            "backend-auth": {"paths": [str(tmp_path / "backend" / "auth")]},
            # frontend 子树 → 归入 "frontend"
            "frontend-app": {"paths": [str(tmp_path / "frontend" / "app")]},
            # 顶级 core 模块 → 归入 "core"（独立一级目录）
            "core": {"paths": [str(tmp_path / "core")]},
        }
    }
    _write_module_map(tmp_path / ".sillyspec" / "docs" / "TestProj" / "modules", module_map)

    service = WorkspaceService(MagicMock())
    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        result = await service.generate_projects(ws.id)

    generated = _load_generated_projects(tmp_path / ".sillyspec" / "projects")
    # 一级子项目 = 路径顶级目录去重：backend / frontend / core（3 个，非 4 个模块级）
    assert set(generated.keys()) == {"backend", "frontend", "core"}
    # 模块级（backend-agent / backend-auth）不再单独成组件
    assert "backend-agent" not in generated
    assert "backend-auth" not in generated
    assert result == {"generated_files": 3}


@pytest.mark.asyncio
async def test_generate_projects_no_relations_section(tmp_path):
    """D-004：关系层已砍，生成的 yaml 不含 relations 段（即便 module_map 带 depends_on）。"""
    ws = _make_ws(tmp_path)
    spec_ws = _make_spec_ws(tmp_path)
    module_map = {
        "modules": {
            "backend-agent": {
                "paths": [str(tmp_path / "backend" / "agent")],
                "depends_on": ["frontend-app"],
            },
            "frontend-app": {"paths": [str(tmp_path / "frontend" / "app")]},
        }
    }
    _write_module_map(tmp_path / ".sillyspec" / "docs" / "TestProj" / "modules", module_map)

    service = WorkspaceService(MagicMock())
    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        await service.generate_projects(ws.id)

    generated = _load_generated_projects(tmp_path / ".sillyspec" / "projects")
    for key, proj in generated.items():
        assert "relations" not in proj, f"{key}.yaml 不应含 relations 段: {proj}"


@pytest.mark.asyncio
async def test_generate_projects_does_not_reparse(tmp_path):
    """D-003：generate_projects 不再调 reparse（方法已删），只产 yaml。"""
    ws = _make_ws(tmp_path)
    spec_ws = _make_spec_ws(tmp_path)
    module_map = {"modules": {"core": {"paths": [str(tmp_path / "core")]}}}
    _write_module_map(tmp_path / ".sillyspec" / "docs" / "TestProj" / "modules", module_map)

    service = WorkspaceService(MagicMock())
    # reparse 方法应已不存在
    assert not hasattr(WorkspaceService, "reparse"), "reparse 方法应已删除"

    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        result = await service.generate_projects(ws.id)

    assert result == {"generated_files": 1}
