---
id: task-07
title: 删除 Component 模块 — 移除 component/ 目录，清理所有引用
priority: P0
estimated_hours: 2
depends_on: [task-04, task-05]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/component/
  - backend/app/main.py
  - backend/migrations/env.py
  - backend/conftest.py
  - backend/app/modules/worktree/service.py
  - backend/app/modules/worktree/tests/test_router.py
  - backend/app/modules/change_writer/tests/test_router.py
  - backend/app/modules/tool_gateway/tests/test_router.py
  - backend/app/modules/git_gateway/tests/test_router.py
author: qinyi
created_at: 2026-05-28 16:25:00
---

# task-07: 删除 Component 模块 — 移除 component/ 目录，清理所有引用

## 设计依据

- design.md ADR-07: Workspace 是唯一基本单元，`project_components` 表删除，其元数据合并到 `workspaces`
- design.md 文件变更清单「后端删除」：`backend/app/modules/component/` 整个模块删除（model, schema, service, router, parser, tests）
- design.md 文件变更清单「后端修改」：`backend/app/main.py` 移除 component router

## 前置条件

本任务依赖 task-04（解析器迁移）和 task-05（Agent 跨空间上下文）完成后执行，确保：
1. `workspace/scanner.py` 不再调用 `component/service.py` 或 `component/parser.py`
2. `agent/context_builder.py` 不再引用 `ProjectComponent`
3. `scan_docs/service.py` 已改为从 Workspace 查询（task-07 前序任务已完成）
4. 所有原先通过 Component 提供的能力已被 Workspace 模块替代

## 修改文件

### 删除（整个目录）

| 路径 | 说明 |
|---|---|
| `backend/app/modules/component/__init__.py` | 模块入口，导出 `component_router` |
| `backend/app/modules/component/model.py` | `ProjectComponent`、`ComponentRelation` 模型定义 |
| `backend/app/modules/component/schema.py` | CRUD schema |
| `backend/app/modules/component/service.py` | `ComponentService` 业务逻辑 |
| `backend/app/modules/component/router.py` | HTTP 端点 |
| `backend/app/modules/component/parser.py` | YAML 解析器 |
| `backend/app/modules/component/tests/test_router.py` | 路由测试 |
| `backend/app/modules/component/tests/test_service.py` | 服务测试 |
| `backend/app/modules/component/tests/test_parser.py` | 解析器测试 |

### 修改（清理 import/引用）

| 路径 | 修改内容 |
|---|---|
| `backend/app/main.py` | 删除第 27 行 `from app.modules.component import component_router`；删除第 104 行 `app.include_router(component_router, prefix="/api")` |
| `backend/migrations/env.py` | 删除第 24 行 `from app.modules.component import model as _component_model  # noqa: F401` |
| `backend/conftest.py` | 删除第 54 行 `from app.modules.component import model as _component_model  # noqa: F401` |
| `backend/app/modules/worktree/service.py` | 删除 `_get_component` 方法（第 269-282 行）及其内部的 `from app.modules.component.model import ProjectComponent`；重构 `acquire` 方法中对 `_get_component` 的调用，改为从 Workspace 模型获取 `repo_url` |
| `backend/app/modules/worktree/tests/test_router.py` | 删除 `_setup_prerequisites` 中的 `from app.modules.component.model import ProjectComponent` 和 `ProjectComponent` 实例创建代码；将 `comp_id` 替换为直接使用 `ws_id`（Workspace 自身拥有 `repo_url`） |
| `backend/app/modules/change_writer/tests/test_router.py` | 同上：删除 `ProjectComponent` import 和实例创建，适配为 Workspace |
| `backend/app/modules/tool_gateway/tests/test_router.py` | 同上：删除 `ProjectComponent` import 和实例创建，适配为 Workspace |
| `backend/app/modules/git_gateway/tests/test_router.py` | 同上：删除 `ProjectComponent` import 和实例创建，适配为 Workspace |

## 实现要求

### IR-01: 删除 component 模块目录

删除 `backend/app/modules/component/` 整个目录（含 `__pycache__/`、`tests/`）。

```bash
rm -rf backend/app/modules/component/
```

验证删除后无残留：
```bash
ls backend/app/modules/component/  # 应返回 "No such file or directory"
```

### IR-02: 清理 main.py 路由注册

在 `backend/app/main.py` 中：

1. 删除 import 行（当前第 27 行）：
   ```python
   # 删除这一行
   from app.modules.component import component_router
   ```

2. 删除路由注册行（当前第 104 行）：
   ```python
   # 删除这一行
   app.include_router(component_router, prefix="/api")
   ```

删除后检查：`app` 的所有 router 注册中不再出现 `component` 字样。

### IR-03: 清理 migrations/env.py 模型注册

在 `backend/migrations/env.py` 中：

删除（当前第 24 行）：
```python
from app.modules.component import model as _component_model  # noqa: F401
```

确认 `BaseModel.metadata` 中不再包含 `project_components` 和 `component_relations` 表。

### IR-04: 清理 conftest.py 模型注册

在 `backend/conftest.py` 的 `db_engine` fixture 中：

删除（当前第 54 行）：
```python
from app.modules.component import model as _component_model  # noqa: F401
```

### IR-05: 重构 worktree/service.py — 移除 ProjectComponent 依赖

`_get_component` 方法（第 269-282 行）当前逻辑：
```python
async def _get_component(self, component_id, workspace_id):
    from app.modules.component.model import ProjectComponent
    # ...查询 ProjectComponent...
```

重构方案：

1. 删除整个 `_get_component` 方法
2. 新增 `_get_workspace` 方法替代：
   ```python
   async def _get_workspace(self, workspace_id: uuid.UUID) -> Workspace:
       from app.modules.workspace.model import Workspace
       stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
       row = (await self._session.execute(stmt)).scalars().first()
       if row is None:
           raise WorktreeLeaseNotFound(
               f"Workspace '{workspace_id}' not found.",
               details={"workspace_id": str(workspace_id)},
           )
       return row
   ```
3. 修改 `acquire` 方法中的调用：
   - 删除 `component = await self._get_component(data.component_id, workspace_id)`
   - 替换为 `workspace = await self._get_workspace(workspace_id)`
   - 将 `component.repo_url` 替换为 `workspace.repo_url`
   - 将 `if not component.repo_url:` 替换为 `if not workspace.repo_url:`
   - 将 `details={"component_id": str(data.component_id)}` 替换为 `details={"workspace_id": str(workspace_id)}`

**注意**：此修改依赖于 task-01 中 Workspace 模型已包含 `repo_url` 字段。如果 `WorktreeLease` 模型中仍保留 `component_id` 字段，则该字段的存在与删除不在本任务范围内（属于数据模型重构 task-01 的范畴）。

### IR-06: 清理 4 个测试文件中的 ProjectComponent 引用

以下 4 个测试文件都有相同的模式：`_setup_prerequisites` 或 `_setup_active_lease` 函数中创建了 `ProjectComponent` 实例作为测试前置数据。

统一的清理步骤（每个文件执行）：

1. 删除 `from app.modules.component.model import ProjectComponent`
2. 删除 `ProjectComponent` 实例创建代码块（约 8 行）
3. 删除返回值中的 `"comp_id": comp_id`
4. 将测试中引用 `p["comp_id"]` / `refs["comp_id"]` 的地方替换为 `p["ws_id"]` / `refs["ws_id"]`（因为 Workspace 现在自身拥有 `repo_url` 等字段）
5. 如果 `WorktreeLease` 构造中使用了 `component_id=comp_id`，则根据 task-01 的模型变更决定如何处理（可能改为 `component_id=ws_id` 或删除该字段）

涉及文件：
- `backend/app/modules/worktree/tests/test_router.py` — `_setup_prerequisites` 函数（第 21-120 行）
- `backend/app/modules/change_writer/tests/test_router.py` — `_setup_prerequisites` 函数（第 16-137 行）
- `backend/app/modules/tool_gateway/tests/test_router.py` — `_setup_active_lease` 函数（第 18-147 行）
- `backend/app/modules/git_gateway/tests/test_router.py` — `_setup_active_lease` 函数（第 22-143 行）

### IR-07: 全局验证无残留引用

完成所有修改后，运行以下命令确认无 `component` 模块残留引用：

```bash
# 排除 component 模块自身（已删除）、migration 版本文件（历史记录，不可改）、alembic 迁移脚本
grep -r "from app.modules.component" backend/ --include="*.py" | grep -v "migrations/versions/"
grep -r "import component" backend/ --include="*.py" | grep -v "migrations/versions/"
grep -r "component_router" backend/ --include="*.py"
grep -r "ProjectComponent" backend/ --include="*.py" | grep -v "migrations/versions/"
```

以上 4 条命令均应返回空结果（除 migration 版本文件中的历史记录外）。

## 接口定义

本任务是删除型任务，不新增接口。以下是修改的方法签名：

### worktree/service.py — WorktreeService._get_workspace（新增，替代 _get_component）

```python
async def _get_workspace(self, workspace_id: uuid.UUID) -> "Workspace":
    """查询 Workspace，不存在则抛出 WorktreeLeaseNotFound。

    替代原先的 _get_component，因为 Workspace 现在包含 repo_url 等元数据。

    Args:
        workspace_id: Workspace UUID

    Returns:
        Workspace 实例

    Raises:
        WorktreeLeaseNotFound: workspace_id 对应的 Workspace 不存在
    """
    from app.modules.workspace.model import Workspace

    stmt = select(Workspace).where(col(Workspace.id) == workspace_id)
    row = (await self._session.execute(stmt)).scalars().first()
    if row is None:
        raise WorktreeLeaseNotFound(
            f"Workspace '{workspace_id}' not found.",
            details={"workspace_id": str(workspace_id)},
        )
    return row
```

### worktree/service.py — WorktreeService.acquire（修改）

修改前的关键片段：
```python
component = await self._get_component(data.component_id, workspace_id)
if not component.repo_url:
    raise WorktreeAcquireFailed(
        "Component has no repo_url configured.",
        details={"component_id": str(data.component_id)},
    )
```

修改后：
```python
workspace = await self._get_workspace(workspace_id)
if not workspace.repo_url:
    raise WorktreeAcquireFailed(
        "Workspace has no repo_url configured.",
        details={"workspace_id": str(workspace_id)},
    )
```

### 测试辅助函数 — 统一模式

每个测试文件中的 `_setup_prerequisites` / `_setup_active_lease` 函数，修改后的 Workspace 创建模式：

```python
ws_id = uuid.uuid4()
ws = Workspace(
    id=ws_id,
    name="Test WS",
    slug=f"test-ws-{ws_id.hex[:8]}",
    root_path="/tmp/test",
    status="active",
    # 以下字段原属 ProjectComponent，现已合并到 Workspace（task-01 完成）
    component_key="backend",
    repo_url="https://github.com/org/repo.git",
    default_branch="main",
    source_yaml_path="projects/backend.yaml",
)
db_session.add(ws)
```

返回值中删除 `"comp_id"` 键。测试中所有 `p["comp_id"]` / `refs["comp_id"]` 引用改为使用 `ws_id`。

## 边界处理

1. **WorktreeLease.model 中 component_id 字段仍存在**：如果 task-01 的迁移保留了 `WorktreeLease.component_id` 作为向后兼容字段（nullable），则测试中创建 `WorktreeLease` 时需要传入 `component_id=ws_id` 或 `component_id=None`，具体取决于 task-01 的实现。本任务需检查 `WorktreeLease` 模型定义后决定。若 `component_id` 已被删除，则从 `WorktreeLease` 构造参数中移除。

2. **scan_docs/service.py 中的 ComponentService 引用**：`scan_docs/service.py` 直接 import `ComponentService` 并使用 `ScanDocument.component_id`。如果此文件在 task-05（SpecWorkspace/ScanDocs 适配）中尚未完成适配，则本任务需确认其状态。若 task-05 已将 scan_docs 改为从 Workspace 查询，则无需额外处理；若未完成，则需在本任务中一并清理（但属于 edge case，需与 task-05 owner 确认）。

3. **migration 版本文件不可修改**：`backend/migrations/versions/202605270900_create_components_and_relations.py` 等历史迁移文件中包含 `ProjectComponent` 引用，这些文件是 Alembic 迁移历史的一部分，不能删除或修改。全局搜索时需排除 `migrations/versions/` 目录。

4. **conftest.py 中的 ScanDocument model 注册**：`conftest.py` 的 `db_engine` fixture 注册了 `_scan_docs_model`，该 model 可能仍包含 `component_id` FK。删除 `_component_model` import 后，需确认 `ScanDocument` 表在 SQLite in-memory 测试中创建时不会因缺少 `project_components` 表而失败。如果 task-01 已将 `ScanDocument.component_id` 改为 `workspace_id`，则无问题。

5. **Workspace sillyspec_path 字段已删除**：部分测试文件中 `Workspace` 构造传入了 `sillyspec_path` 参数（如 worktree test_router.py 第 38 行 `sillyspec_path="/tmp/test/.sillyspec"`）。根据 design.md，`sillyspec_path` 字段已删除。本任务清理测试时需同步移除该参数，否则 `Workspace.__init__` 会因未知字段报错。

6. **__pycache__ 残留**：删除 `component/` 目录后，`__pycache__` 目录可能残留在文件系统。需确保完全删除（含 `.pyc` 文件），否则 IDE 或 Python 运行时可能缓存旧模块。

7. **其他模块的间接依赖**：全局搜索发现 `backend/app/modules/spec_workspace/validator.py` 和 `backend/app/modules/agent/tests/test_router.py` 中存在 `component_id` 或 `component_key` 引用。需逐一检查：如果是引用 Workspace 模型字段（已在 task-01 合并），则无需修改；如果是直接 import Component 模块，则需清理。

## 非目标

- 不修改 Alembic 迁移历史文件（`migrations/versions/` 目录下的历史迁移脚本保持原样）
- 不修改前端代码（前端 component 相关页面由独立任务处理）
- 不删除数据库中已有的 `project_components` 和 `component_relations` 表数据（由 Alembic downgrade migration 处理）
- 不重构 `WorktreeLease` 模型中的 `component_id` 字段（属于 task-01 数据模型重构的范畴）
- 不修改 `scan_docs/model.py` 中 `ScanDocument.component_id` 字段定义（属于 task-05 适配任务的范畴，除非该字段已在 task-01 中迁移）
- 不处理 `__init__.py` 中可能存在的其他模块对 component 的间接引用（如 `from .model import *`）

## 参考

- design.md — ADR-07: Workspace 是唯一基本单元
- design.md — 文件变更清单「后端删除」和「后端修改」
- plan.md — Wave 3: task-06 删除 Component 模块（对应本 task-07）
- `backend/app/modules/component/` — 即将删除的模块源码
- `backend/app/modules/workspace/model.py` — 合并了 component 元数据的 Workspace 模型（task-01 产出）

## TDD 步骤

### Step 1: 编写验证测试（先于实现）

创建一个临时测试文件或在现有测试中添加，验证 component 模块已不可导入：

```python
# 在 pytest 中验证 component 模块不可导入
def test_component_module_not_importable():
    """component 模块已删除，import 应失败。"""
    import importlib
    with pytest.raises(ModuleNotFoundError):
        importlib.import_module("app.modules.component")
```

### Step 2: 运行现有测试（Red）

```bash
cd backend && python -m pytest app/modules/worktree/tests/test_router.py -x
```

预期：测试因 `from app.modules.component.model import ProjectComponent` 而失败。

### Step 3: 删除 component 目录

```bash
rm -rf backend/app/modules/component/
```

### Step 4: 清理所有 import（按文件逐一修改）

按以下顺序修改：
1. `backend/app/main.py` — 删除 import + router 注册
2. `backend/migrations/env.py` — 删除 model import
3. `backend/conftest.py` — 删除 model import
4. `backend/app/modules/worktree/service.py` — 替换 `_get_component` 为 `_get_workspace`
5. `backend/app/modules/worktree/tests/test_router.py` — 删除 ProjectComponent，适配 Workspace
6. `backend/app/modules/change_writer/tests/test_router.py` — 同上
7. `backend/app/modules/tool_gateway/tests/test_router.py` — 同上
8. `backend/app/modules/git_gateway/tests/test_router.py` — 同上

### Step 5: 运行测试（Green）

```bash
cd backend && python -m pytest -x
```

所有测试应通过。

### Step 6: 全局残留检查（Refactor/Verify）

```bash
# 确认无残留引用（排除 migration 历史文件）
cd backend && grep -rn "from app.modules.component" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "ProjectComponent" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "component_router" --include="*.py"
cd backend && grep -rn "_component_model" --include="*.py" | grep -v "migrations/versions/"
```

以上命令应全部返回空。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ls backend/app/modules/component/` | 目录不存在（返回 "No such file or directory"） |
| AC-02 | `python -c "from app.modules.component import component_router"` | 抛出 `ModuleNotFoundError` |
| AC-03 | `python -m pytest backend/app/main.py` 或应用启动 | 应用正常创建，无 import 错误 |
| AC-04 | 检查 `backend/app/main.py` | 不包含 `component_router` 字样 |
| AC-05 | 检查 `backend/migrations/env.py` | 不包含 `_component_model` 字样 |
| AC-06 | 检查 `backend/conftest.py` | 不包含 `_component_model` 字样 |
| AC-07 | 检查 `backend/app/modules/worktree/service.py` | 不包含 `ProjectComponent` 或 `_get_component`，包含 `_get_workspace` 方法 |
| AC-08 | 检查 4 个测试文件（worktree/change_writer/tool_gateway/git_gateway） | 均不包含 `ProjectComponent` 或 `from app.modules.component` |
| AC-09 | `cd backend && python -m pytest app/modules/worktree/tests/test_router.py -x` | 全部测试通过 |
| AC-10 | `cd backend && python -m pytest app/modules/change_writer/tests/test_router.py -x` | 全部测试通过 |
| AC-11 | `cd backend && python -m pytest app/modules/tool_gateway/tests/test_router.py -x` | 全部测试通过 |
| AC-12 | `cd backend && python -m pytest app/modules/git_gateway/tests/test_router.py -x` | 全部测试通过 |
| AC-13 | `cd backend && python -m pytest -x` | 全局测试通过，无回归 |
| AC-14 | 全局搜索残留引用（排除 migrations/versions/） | `grep -rn "from app.modules.component" --include="*.py"` 返回空 |
| AC-15 | 全局搜索 `ProjectComponent`（排除 migrations/versions/） | 返回空 |
| AC-16 | 全局搜索 `component_router` | 返回空 |
