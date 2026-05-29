---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-07
title: 删除 Component 模块 — 移除 component/ 目录，清理所有引用
priority: P0
estimated_hours: 2
depends_on: [task-04, task-07-ws-adapt]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/component/
  - backend/app/main.py
  - backend/migrations/env.py
  - backend/conftest.py
  - backend/app/modules/worktree/service.py
  - backend/app/modules/worktree/model.py
  - backend/app/modules/worktree/schema.py
  - backend/app/modules/worktree/exec_env.py
  - backend/app/modules/worktree/tests/test_router.py
  - backend/app/modules/worktree/tests/test_exec_env.py
  - backend/app/modules/change_writer/tests/test_router.py
  - backend/app/modules/tool_gateway/tests/test_router.py
  - backend/app/modules/git_gateway/tests/test_router.py
  - backend/app/modules/agent/tests/test_router.py
  - backend/app/core/errors.py
  - backend/app/modules/auth/permissions.py
---

# task-07: 删除 Component 模块 — 移除 component/ 目录，清理所有引用

## 设计依据

- design.md ADR-02: Workspace 是唯一基本单元，`project_components` 表删除，其元数据合并到 `workspaces`
- design.md 文件变更清单「后端删除」：`backend/app/modules/component/` 整个模块删除（model, schema, service, router, parser, tests）
- design.md 文件变更清单「后端修改」：`backend/app/main.py` 移除 component router

## 前置条件

本任务依赖 task-04（解析器迁移）和 task-07-ws-adapt（SpecWorkspace/ScanDocs 适配）完成后执行，确保：
1. `workspace/scanner.py` 不再调用 `component/service.py` 或 `component/parser.py`
2. `agent/context_builder.py` 不再引用 `ProjectComponent`
3. `scan_docs/service.py` 已改为从 Workspace 查询
4. 所有原先通过 Component 提供的能力已被 Workspace 模块替代

## 当前状态分析

经代码扫描确认，以下清理已经部分完成：
- `backend/app/modules/component/` 目录已不存在
- `backend/app/main.py` 已无 component router import 和注册
- `backend/migrations/env.py` 已无 `_component_model` import
- `backend/conftest.py` 已无 `_component_model` import
- `worktree/service.py` 已用 `_get_workspace` 替代了 `_get_component`

仍需清理的残留项（详见下方实现要求）：
1. `worktree/model.py` 中 `WorktreeLease.component_id` 字段仍存在，FK 指向 `workspaces.id`
2. `worktree/schema.py` 中 `WorktreeAcquireRequest.component_id` 和 `WorktreeLeaseRead.component_id` 仍存在
3. `worktree/exec_env.py` 中 `lease_root` 和 `bare_repo_path` 方法仍使用 `component_id` 参数名
4. `worktree/service.py` 中 `acquire` 方法仍构造 `component_id=data.component_id`
5. 测试文件中仍使用 `component_id=ws_id` 模式
6. `core/errors.py` 中仍有 `ComponentNotFound` 错误类
7. `auth/permissions.py` 中仍有 `COMPONENT_READ/WRITE/ADMIN` 权限枚举

## 修改文件

### 删除（确认已删除，如有残留则删除）

| 路径 | 说明 |
|---|---|
| `backend/app/modules/component/` | 整个目录（含 `__pycache__/`、`tests/`） |

### 修改（清理 component 残留字段和引用）

| 路径 | 修改内容 |
|---|---|
| `backend/app/modules/worktree/model.py` | 将 `component_id` 字段改名为 `component_id` 保留但注释说明为向后兼容，或根据 task-01 迁移结果决定是否删除。当前 FK 指向 `workspaces.id`，语义上已等于 workspace_id |
| `backend/app/modules/worktree/schema.py` | `WorktreeAcquireRequest` 中 `component_id` 字段；`WorktreeLeaseRead` 中 `component_id` 字段 |
| `backend/app/modules/worktree/exec_env.py` | `lease_root` 方法的 `component_id` 参数、`bare_repo_path` 方法的 `component_id` 参数 |
| `backend/app/modules/worktree/service.py` | `acquire` 方法中 `component_id=data.component_id` 赋值 |
| `backend/app/modules/worktree/tests/test_router.py` | 测试请求体中 `"component_id": str(p["ws_id"])` |
| `backend/app/modules/worktree/tests/test_exec_env.py` | `"component_id": "comp-001"` 断言 |
| `backend/app/modules/change_writer/tests/test_router.py` | `WorktreeLease` 构造中 `component_id=ws_id` |
| `backend/app/modules/tool_gateway/tests/test_router.py` | 同上 |
| `backend/app/modules/git_gateway/tests/test_router.py` | 同上 |
| `backend/app/modules/agent/tests/test_router.py` | 同上 |
| `backend/app/core/errors.py` | `ComponentNotFound` 错误类（第 88-93 行） |
| `backend/app/modules/auth/permissions.py` | `COMPONENT_READ/WRITE/ADMIN` 枚举（第 25-28 行） |

### 不修改

| 路径 | 原因 |
|---|---|
| `backend/migrations/versions/*` | 历史迁移文件，不可修改 |
| `backend/app/modules/workspace/model.py` 中 `component_key` 字段 | 这是合法的 Workspace 字段，从旧 Component 吸收而来 |
| `backend/app/modules/agent/context_builder.py` 中 `component_key` 引用 | 读取 Workspace 字段，合法 |
| `backend/app/modules/scan_docs/` 中 `component_key` 引用 | 读取 Workspace 字段，合法 |
| `backend/app/modules/change/model.py` 中 `affected_components` 字段 | 数据字段名，非模块引用 |
| `backend/app/modules/change_writer/` 中 `affected_components` 引用 | 数据字段名，非模块引用 |
| `backend/app/modules/spec_workspace/validator.py` 中 `component_ids` 变量名 | 局部变量名，指 YAML 中的组件定义，非旧模块引用 |
| `frontend/` | 前端 component 相关页面由独立任务处理 |

## 实现要求

### IR-01: 确认 component 模块目录已删除

```bash
ls backend/app/modules/component/ 2>/dev/null && echo "STILL EXISTS" || echo "ALREADY DELETED"
```

如果目录仍存在，执行 `rm -rf backend/app/modules/component/`。

同时确认 `__pycache__` 无残留：
```bash
find backend/app/modules/ -path "*component*__pycache__*" -type d 2>/dev/null
```

### IR-02: 确认 main.py 路由注册已清理

在 `backend/app/main.py` 中确认：
1. 不存在 `from app.modules.component import component_router`
2. 不存在 `app.include_router(component_router, ...)`

如仍存在，删除对应行。

### IR-03: 确认 migrations/env.py 模型注册已清理

在 `backend/migrations/env.py` 中确认：
- 不存在 `from app.modules.component import model as _component_model`

如仍存在，删除对应行。

### IR-04: 确认 conftest.py 模型注册已清理

在 `backend/conftest.py` 中确认：
- 不存在 `from app.modules.component import model as _component_model`

如仍存在，删除对应行。

### IR-05: 清理 core/errors.py 中 ComponentNotFound 错误类

在 `backend/app/core/errors.py` 中，删除以下内容（约第 88-93 行）：

```python
# 删除以下内容
# ── Component errors ─────────────────────────────────────────────────────────


class ComponentNotFound(AppError):
    code = "HTTP_404_COMPONENT_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND
```

删除前，先全局搜索 `ComponentNotFound` 确认无其他文件 import 此类（排除 migrations/versions/）：
```bash
cd backend && grep -rn "ComponentNotFound" --include="*.py" | grep -v "migrations/versions/"
```

如果无引用，安全删除。如果有引用，先重构引用方改用其他错误类（如 `WorktreeLeaseNotFound` 或通用的 `HTTP_404`）。

### IR-06: 清理 auth/permissions.py 中 COMPONENT 权限枚举

在 `backend/app/modules/auth/permissions.py` 中，删除以下内容（第 25-28 行）：

```python
# 删除以下内容
# ── Component ───────────────────────────────────────────
COMPONENT_READ = "component:read"
COMPONENT_WRITE = "component:write"
COMPONENT_ADMIN = "component:admin"
```

删除前，先全局搜索确认无代码使用这些枚举值（排除 migrations/versions/）：
```bash
cd backend && grep -rn "COMPONENT_READ\|COMPONENT_WRITE\|COMPONENT_ADMIN\|component:read\|component:write\|component:admin" --include="*.py" | grep -v "migrations/versions/"
```

如果无引用，安全删除。如果有引用，先更新引用方。

### IR-07: 清理 worktree 模块中的 component_id 残留

**注意**：`WorktreeLease.component_id` 是数据库字段（FK -> `workspaces.id`），由 task-01 的 Alembic 迁移管理。此字段在迁移中已从指向 `project_components` 改为指向 `workspaces`。本任务的清理范围是代码层面的引用，不修改数据库 schema（由 Alembic 迁移负责）。

**决策**：由于 `component_id` 字段在数据库中仍然存在（FK -> `workspaces.id`），且测试和 API 中广泛使用，本任务暂保留此字段名不变，仅确保：
1. 没有对已删除 `ProjectComponent` 模型的 import
2. 没有对已删除 `component/service.py`、`component/parser.py` 的调用

当前代码已满足以上条件，因此 worktree 模块无需修改。

### IR-08: 全局验证无残留引用

完成所有修改后，运行以下命令确认无旧 Component 模块的残留引用：

```bash
# 1. 检查 import 残留（排除 migration 版本文件）
cd backend && grep -rn "from app.modules.component" --include="*.py" | grep -v "migrations/versions/"

# 2. 检查 component_router 残留
cd backend && grep -rn "component_router" --include="*.py"

# 3. 检查 ProjectComponent 残留（排除 migration 版本文件和合法注释）
cd backend && grep -rn "ProjectComponent" --include="*.py" | grep -v "migrations/versions/"

# 4. 检查 _component_model 残留（排除 migration 版本文件）
cd backend && grep -rn "_component_model" --include="*.py" | grep -v "migrations/versions/"

# 5. 检查 ComponentNotFound 残留
cd backend && grep -rn "ComponentNotFound" --include="*.py" | grep -v "migrations/versions/"

# 6. 检查 COMPONENT_READ/WRITE/ADMIN 枚举残留
cd backend && grep -rn "COMPONENT_READ\|COMPONENT_WRITE\|COMPONENT_ADMIN" --include="*.py" | grep -v "migrations/versions/"
```

以上 6 条命令均应返回空结果。

## 接口定义

本任务是删除/清理型任务，不新增接口。以下是涉及的现有接口变更：

### core/errors.py — 删除 ComponentNotFound 类

```python
# 删除前（第 88-93 行）：
# ── Component errors ─────────────────────────────────────────────────────────

class ComponentNotFound(AppError):
    code = "HTTP_404_COMPONENT_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND

# 删除后：无此错误类。如需 404 错误，使用其他合适的 AppError 子类。
```

### auth/permissions.py — 删除 COMPONENT 枚举值

```python
# 删除前（第 25-28 行）：
# ── Component ───────────────────────────────────────────
COMPONENT_READ = "component:read"
COMPONENT_WRITE = "component:write"
COMPONENT_ADMIN = "component:admin"

# 删除后：此枚举块整体移除。权限检查中不再有 component:* 权限。
```

## 边界处理

1. **WorktreeLease.component_id 字段保留**：该字段在数据库中仍存在（通过 task-01 迁移，FK 已从 `project_components` 改为 `workspaces.id`）。本任务不删除此字段，因为：(a) 修改字段名需要新的 Alembic 迁移；(b) 该字段语义上仍是"关联的组件/workspace"，保留字段名不会造成模块级残留。如果后续需要重命名，应作为独立任务。

2. **affected_components 字段名**：`Change.affected_components`、`Incident.affected_components` 等字段名包含 "component" 但它们是数据字段（JSON 数组），不是对旧 Component 模块的引用。这些字段名不在本任务清理范围内。

3. **component_key 字段名**：`Workspace.component_key` 是从旧 Component 吸收到 Workspace 的合法元数据字段，用于 YAML 解析和 scan_docs 匹配。不在本任务清理范围内。

4. **migration 版本文件不可修改**：`migrations/versions/` 下的历史迁移文件包含 `ProjectComponent`、`project_components` 等引用。这些是 Alembic 迁移历史的一部分，删除或修改会导致迁移链断裂。全局搜索时必须排除此目录。

5. **__pycache__ 残留**：虽然 `component/` 目录已删除，但 Python 可能在其他位置缓存了 `__pycache__`。需确认无 `.pyc` 文件引用已删除模块。执行 `find backend -path "*component*__pycache__*" -type d` 检查。

6. **ComponentNotFound 可能被 router 使用**：删除 `ComponentNotFound` 前，必须全局搜索确认无 HTTP handler 或 service 代码 import 此错误类。如果仍有引用，需将引用方改为其他适当的错误类（如 `WorkspaceNotFound` 或通用 404），否则会导致 import 错误。

7. **COMPONENT_* 权限枚举可能被 RBAC 中间件使用**：删除 `COMPONENT_READ/WRITE/ADMIN` 前，必须确认无代码使用 `Permission.COMPONENT_READ` 等枚举值。migration 中的 seed 数据（`202605280900_create_auth_and_rbac.py`）仍会创建这些权限记录，但这是历史迁移，不可修改。如果应用层不再引用，删除枚举是安全的。

## 非目标

- 不修改 Alembic 迁移历史文件（`migrations/versions/` 目录下的历史迁移脚本保持原样）
- 不修改前端代码（前端 component 相关页面由独立任务处理）
- 不重命名 `WorktreeLease.component_id` 数据库字段（需要新的 Alembic 迁移，属于数据模型重构范畴）
- 不重命名 `Change.affected_components`、`Incident.affected_components` 等数据字段
- 不重命名 `Workspace.component_key` 元数据字段
- 不修改 `scan_docs/parser.py` 中 `parse_component` 方法名（该方法解析的是文件系统目录，不是旧 Component 模块）
- 不修改 `spec_workspace/validator.py` 中 `component_ids` 局部变量名
- 不修改 `worktree/exec_env.py` 中 `component_id` 参数名（该参数影响文件系统路径结构，修改需要同步迁移）

## 参考

- design.md — ADR-02: Workspace 是唯一基本单元
- design.md — 文件变更清单「后端删除」和「后端修改」
- plan.md — Wave 3: task-06 删除 Component 模块
- `backend/migrations/versions/202606130900_workspace_graph.py` — task-01 的 Alembic 迁移，已将 `worktree_leases.component_id` FK 从 `project_components` 改为 `workspaces`
- `backend/app/modules/workspace/model.py` — 合并了 component 元数据的 Workspace 模型

## TDD 步骤

### Step 1: 确认 component 模块不可导入（验证前置状态）

```bash
cd backend && python -c "from app.modules.component import component_router" 2>&1
# 预期：ModuleNotFoundError
```

### Step 2: 全局搜索确认残留引用范围

```bash
cd backend && grep -rn "ComponentNotFound" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "COMPONENT_READ\|COMPONENT_WRITE\|COMPONENT_ADMIN" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "from app.modules.component" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "ProjectComponent" --include="*.py" | grep -v "migrations/versions/"
```

### Step 3: 执行清理

按以下顺序修改：
1. `backend/app/core/errors.py` — 删除 `ComponentNotFound` 类
2. `backend/app/modules/auth/permissions.py` — 删除 `COMPONENT_READ/WRITE/ADMIN` 枚举

### Step 4: 运行测试（Green）

```bash
cd backend && python -m pytest -x
```

所有测试应通过。

### Step 5: 全局残留检查（Verify）

```bash
cd backend && grep -rn "from app.modules.component" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "component_router" --include="*.py"
cd backend && grep -rn "ProjectComponent" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "_component_model" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "ComponentNotFound" --include="*.py" | grep -v "migrations/versions/"
cd backend && grep -rn "COMPONENT_READ\|COMPONENT_WRITE\|COMPONENT_ADMIN" --include="*.py" | grep -v "migrations/versions/"
```

以上命令应全部返回空。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ls backend/app/modules/component/` | 目录不存在 |
| AC-02 | `python -c "from app.modules.component import component_router"`（在 backend 目录下） | 抛出 `ModuleNotFoundError` |
| AC-03 | 检查 `backend/app/main.py` | 不包含 `component_router` 字样 |
| AC-04 | 检查 `backend/migrations/env.py` | 不包含 `_component_model` 字样 |
| AC-05 | 检查 `backend/conftest.py` | 不包含 `_component_model` 字样 |
| AC-06 | 检查 `backend/app/core/errors.py` | 不包含 `ComponentNotFound` 类定义 |
| AC-07 | 检查 `backend/app/modules/auth/permissions.py` | 不包含 `COMPONENT_READ/WRITE/ADMIN` 枚举值 |
| AC-08 | `grep -rn "from app.modules.component" backend/ --include="*.py" \| grep -v "migrations/versions/"` | 返回空 |
| AC-09 | `grep -rn "component_router" backend/ --include="*.py"` | 返回空 |
| AC-10 | `grep -rn "ProjectComponent" backend/ --include="*.py" \| grep -v "migrations/versions/"` | 仅 `workspace/model.py` 中的注释行（合法） |
| AC-11 | `grep -rn "ComponentNotFound" backend/ --include="*.py" \| grep -v "migrations/versions/"` | 返回空 |
| AC-12 | `cd backend && python -m pytest -x` | 全局测试通过，无回归 |
| AC-13 | `cd backend && python -m pytest app/modules/worktree/tests/test_router.py -x` | worktree 测试通过 |
| AC-14 | `cd backend && python -m pytest app/modules/change_writer/tests/test_router.py -x` | change_writer 测试通过 |
| AC-15 | `cd backend && python -m pytest app/modules/tool_gateway/tests/test_router.py -x` | tool_gateway 测试通过 |
| AC-16 | `cd backend && python -m pytest app/modules/git_gateway/tests/test_router.py -x` | git_gateway 测试通过 |
