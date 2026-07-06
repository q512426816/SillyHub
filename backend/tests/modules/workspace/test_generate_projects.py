"""WorkspaceService.generate_projects 的 depends_on 聚合回归测试。

回归一个累积变量作用域 bug：``all_relations`` 曾声明在分组循环【外面】，
每个组件分组都往这个共享列表里 append 依赖，写 yaml 时又用的是"累积至今"
的全部，导致第 N 个分组背上前 N-1 个分组累积的依赖（"万物依赖万物"），
并因旧条目残留产生 ``auth -> auth`` 之类的自环。
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
    result = {}
    for f in projects_dir.glob("*.yaml"):
        result[f.stem] = yaml.safe_load(f.read_text(encoding="utf-8"))
    return result


def _relations_targets(proj):
    return sorted(r["target"] for r in (proj.get("relations") or []))


@pytest.mark.asyncio
async def test_generate_projects_relations_not_polluted_across_groups(tmp_path):
    """各组件分组的 relations 互不污染：core/models 无依赖，frontend 只依赖 backend。"""
    ws_id = uuid.uuid4()
    ws = MagicMock()
    ws.id = ws_id
    ws.name = "TestProj"
    ws.root_path = str(tmp_path)

    spec_ws = MagicMock()
    spec_ws.strategy = "platform-managed"
    spec_ws.spec_root = str(tmp_path)

    # 构造 _module-map.yaml：
    #   core / models      无依赖
    #   auth               依赖 core
    #   backend-agent      依赖 core, models
    #   backend-auth       依赖 core, models, auth   ← backend 分组贡献 core/models/auth
    #   frontend-app       依赖 backend-agent        ← frontend 分组只贡献 backend
    module_map = {
        "modules": {
            "core": {"paths": [str(tmp_path / "core")], "depends_on": []},
            "models": {"paths": [str(tmp_path / "models")], "depends_on": []},
            "auth": {"paths": [str(tmp_path / "auth")], "depends_on": ["core"]},
            "backend-agent": {
                "paths": [str(tmp_path / "backend" / "agent")],
                "depends_on": ["core", "models"],
            },
            "backend-auth": {
                "paths": [str(tmp_path / "backend" / "auth")],
                "depends_on": ["core", "models", "auth"],
            },
            "frontend-app": {
                "paths": [str(tmp_path / "frontend" / "app")],
                "depends_on": ["backend-agent"],
            },
        }
    }
    _write_module_map(tmp_path / ".sillyspec" / "docs" / "TestProj" / "modules", module_map)

    service = WorkspaceService(MagicMock())

    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch.object(
            WorkspaceService,
            "reparse",
            new_callable=AsyncMock,
            return_value=(MagicMock(), {}, [], []),
        ),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        await service.generate_projects(ws_id)

    generated = _load_generated_projects(tmp_path / ".sillyspec" / "projects")

    # bug 下：core 会被污染成 [core, models, auth]
    assert _relations_targets(generated["core"]) == [], (
        f"core 不应有依赖, 实际: {_relations_targets(generated['core'])}"
    )
    assert _relations_targets(generated["models"]) == [], (
        f"models 不应有依赖, 实际: {_relations_targets(generated['models'])}"
    )

    # bug 下：frontend 会被污染成 [core, models, auth, backend]
    assert _relations_targets(generated["frontend"]) == ["backend"], (
        f"frontend 应只依赖 backend, 实际: {_relations_targets(generated['frontend'])}"
    )

    # backend 分组自身确实依赖 core/models/auth
    assert _relations_targets(generated["backend"]) == ["auth", "core", "models"], (
        f"backend 依赖不符, 实际: {_relations_targets(generated['backend'])}"
    )

    assert _relations_targets(generated["auth"]) == ["core"], (
        f"auth 应只依赖 core, 实际: {_relations_targets(generated['auth'])}"
    )


@pytest.mark.asyncio
async def test_generate_projects_no_self_loop_relations(tmp_path):
    """生成的 projects yaml 不能出现 target == 自身 component_key 的自环。"""
    ws_id = uuid.uuid4()
    ws = MagicMock()
    ws.id = ws_id
    ws.name = "TestProj"
    ws.root_path = str(tmp_path)

    spec_ws = MagicMock()
    spec_ws.strategy = "platform-managed"
    spec_ws.spec_root = str(tmp_path)

    # auth 被 backend 依赖；bug 下累积的 {target: auth} 残留会使 auth.yaml
    # 出现 auth -> auth 自环。
    module_map = {
        "modules": {
            "core": {"paths": [str(tmp_path / "core")], "depends_on": []},
            "auth": {"paths": [str(tmp_path / "auth")], "depends_on": ["core"]},
            "backend-auth": {
                "paths": [str(tmp_path / "backend" / "auth")],
                "depends_on": ["core", "auth"],
            },
        }
    }
    _write_module_map(tmp_path / ".sillyspec" / "docs" / "TestProj" / "modules", module_map)

    service = WorkspaceService(MagicMock())

    with (
        patch.object(WorkspaceService, "get", new_callable=AsyncMock, return_value=ws),
        patch.object(
            WorkspaceService,
            "reparse",
            new_callable=AsyncMock,
            return_value=(MagicMock(), {}, [], []),
        ),
        patch(
            "app.modules.spec_workspace.service.SpecWorkspaceService.get",
            new_callable=AsyncMock,
            return_value=spec_ws,
        ),
    ):
        await service.generate_projects(ws_id)

    generated = _load_generated_projects(tmp_path / ".sillyspec" / "projects")

    for key, proj in generated.items():
        targets = [r["target"] for r in (proj.get("relations") or [])]
        assert key not in targets, f"{key}.yaml 出现自环 (target == 自身): {targets}"
