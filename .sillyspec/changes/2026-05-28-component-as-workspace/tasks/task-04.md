---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-04
title: SpecWorkspace/ScanDocs 适配 — 适配新 Workspace 模型
priority: P1
estimated_hours: 3
depends_on: [task-01]
blocks: [task-06]
allowed_paths:
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/scan_docs/model.py
  - backend/app/modules/scan_docs/schema.py
  - backend/app/modules/scan_docs/router.py
  - backend/app/modules/scan_docs/tests/test_service.py
  - backend/app/modules/scan_docs/tests/test_router.py
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/bootstrap.py
---

# task-04: SpecWorkspace/ScanDocs 适配 — 适配新 Workspace 模型

## 背景

根据 design.md ADR-02，Workspace 是唯一基本单元，`project_components` 表将被删除。task-01 已将 Component 元数据字段（`component_key`, `type`, `role`, `repo_url`, `default_branch`, `tech_stack`, `build_command`, `test_command`, `source_yaml_path`）吸收进 `workspaces` 表。

当前代码中 `scan_docs/` 和 `spec_workspace/` 两个模块的实际状态：

- **scan_docs/service.py**：已使用 `WorkspaceService`（不含 `ComponentService` 依赖），所有方法以 `workspace_id` 为唯一参数，`reparse()` 通过 `workspace.component_key` 获取解析键。**该文件已完成迁移，无需修改。**
- **scan_docs/model.py**：`ScanDocument` 已只有 `workspace_id` FK（无 `component_id`），索引为 `ux_scan_docs_workspace_type(workspace_id, doc_type)`。**已完成迁移。**
- **scan_docs/schema.py**：DTO 已使用 `workspace_id`。**已完成迁移。**
- **scan_docs/router.py**：路由前缀为 `/workspaces/{workspace_id}`，权限使用 `WORKSPACE_READ` / `WORKSPACE_WRITE`。**已完成迁移。**
- **spec_workspace/service.py**：通过 `SpecWorkspace.workspace_id` 查询，不引用 `ComponentService`。**已完成迁移。**
- **spec_workspace/bootstrap.py**：通过 `Workspace.root_path` 和 `SpecWorkspace.workspace_id` 查询，不引用 `ComponentService`。**已完成迁移。**

因此，本任务实际为 **验证 + 补测试** 任务：确认所有代码已正确迁移到 Workspace-only 模型，并补全验收级别的测试。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/scan_docs/service.py` | 验证（只读） | 确认已无 `ComponentService` / `component_id` 引用 |
| `backend/app/modules/scan_docs/model.py` | 验证（只读） | 确认已无 `component_id` 列 |
| `backend/app/modules/scan_docs/schema.py` | 验证（只读） | 确认 DTO 使用 `workspace_id` |
| `backend/app/modules/scan_docs/router.py` | 验证（只读） | 确认路由无 `/components/` 路径 |
| `backend/app/modules/scan_docs/tests/test_service.py` | 验证（只读） | 确认测试覆盖 workspace-only 语义 |
| `backend/app/modules/scan_docs/tests/test_router.py` | 验证（只读） | 确认 HTTP 测试使用 workspace 路由 |
| `backend/app/modules/spec_workspace/service.py` | 验证（只读） | 确认无 Component 引用 |
| `backend/app/modules/spec_workspace/bootstrap.py` | 验证（只读） | 确认通过 `workspace.root_path` 工作 |
| `backend/app/modules/spec_workspace/tests/test_bootstrap.py` | 验证（只读） | 确认测试使用 Workspace 模型 |

如果验证过程中发现遗漏（grep 到 `ComponentService`、`ProjectComponent`、`component_id` 等残留），则修复对应文件。

## 实现要求

### IR-01: 验证 scan_docs 模块无 Component 残留

使用 grep 搜索 `backend/app/modules/scan_docs/` 目录，确认以下字符串均不存在：
- `ComponentService`
- `ProjectComponent`
- `component_id`（除 `workspace_id` 以外的任何包含 `component_id` 的引用）
- `component_service`
- `COMPONENT_READ`
- `COMPONENT_WRITE`

### IR-02: 验证 spec_workspace 模块无 Component 残留

使用 grep 搜索 `backend/app/modules/spec_workspace/` 目录，确认上述字符串均不存在。

### IR-03: 验证 ScanDocsService 构造函数

确认 `ScanDocsService.__init__` 接收 `workspace_service: WorkspaceService` 参数，不含 `component_service` 参数。

### IR-04: 验证 ScanDocsService.reparse() 的 sillyspec_root 确定逻辑

当前 `reparse()` 的 sillyspec_root 确定逻辑为：

```python
workspace = await self._workspace_service.get(workspace_id)
sillyspec_root = Path(workspace.root_path)
```

直接使用 `workspace.root_path`。如果后续需要支持 `SpecWorkspace.spec_root` 的 fallback，可在未来任务中处理。当前行为已符合 ADR-02（Workspace 是唯一基本单元，`root_path` 可以指向独立仓库或 monorepo 子目录）。

### IR-05: 验证 Router 路由路径

确认三个 API 端点：
- `GET /workspaces/{workspace_id}/scan-docs`
- `GET /workspaces/{workspace_id}/scan-docs/{doc_type}`
- `POST /workspaces/{workspace_id}/scan-docs/reparse`

无任何 `/components/` 路径段。

### IR-06: 验证权限

确认所有 `require_permission` 调用使用 `Permission.WORKSPACE_READ` 或 `Permission.WORKSPACE_WRITE`。

### IR-07: 验证现有测试覆盖

确认以下测试文件存在且通过：
- `backend/app/modules/scan_docs/tests/test_service.py`：覆盖 `list_()`, `get()`, `reparse()` 的 workspace-only 语义
- `backend/app/modules/scan_docs/tests/test_router.py`：覆盖 HTTP 端点的 workspace 路由
- `backend/app/modules/scan_docs/tests/test_parser.py`：parser 不受此迁移影响，确认仍通过
- `backend/app/modules/spec_workspace/tests/test_bootstrap.py`：确认使用 Workspace 模型

## 接口定义

### 当前 ScanDocsService 公开接口（已迁移完成，无需修改）

```python
class ScanDocsService:
    """List, fetch, and reparse scan documents for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ScanDocsParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        """
        Args:
            session: AsyncSession 数据库会话
            parser: 可选的 ScanDocsParser 实例（默认新建）
            workspace_service: 可选的 WorkspaceService 实例（默认新建）
        """

    async def list_(
        self, workspace_id: uuid.UUID
    ) -> tuple[list[ScanDocument], int]:
        """
        列出指定 workspace 的所有 scan docs。

        Args:
            workspace_id: 目标 workspace 的 UUID

        Returns:
            (scan_docs列表, 总数)

        Raises:
            WorkspaceNotFound: workspace 不存在或已软删除
        """

    async def get(
        self,
        workspace_id: uuid.UUID,
        doc_type: str,
    ) -> ScanDocument:
        """
        获取指定 workspace 的单个 scan doc（按 doc_type）。

        Args:
            workspace_id: 目标 workspace 的 UUID
            doc_type: 文档类型，如 "ARCHITECTURE"

        Returns:
            ScanDocument 记录

        Raises:
            WorkspaceNotFound: workspace 不存在
            ScanDocNotFound: 该 doc_type 的记录不存在
        """

    async def reparse(
        self, workspace_id: uuid.UUID
    ) -> tuple[dict[str, int], list[ScanDocsResult]]:
        """
        重新解析指定 workspace 的 scan docs。

        从 Workspace.root_path 读取文件系统，
        与 DB 现有记录做 diff-based UPSERT。

        控制流：
        1. workspace = await self._workspace_service.get(workspace_id)
        2. sillyspec_root = Path(workspace.root_path)
        3. component_key = getattr(workspace, "component_key", None)
        4. 如果 component_key 为 None，返回空 stats + 空 results
        5. result = self._parser.parse_component(sillyspec_root, component_key)
        6. 获取现有 ScanDocument 行，按 doc_type 索引
        7. 遍历 parsed docs：
           - exists=True 且已有行 -> _apply_parsed 更新
           - exists=True 且无行 -> _build_row 新建
           - exists=False 且已有行 -> 标记 exists=False
           - exists=False 且无行 -> _build_row 新建占位
        8. _sync_other_docs 处理 OTHER 类型
        9. commit

        Args:
            workspace_id: 目标 workspace 的 UUID

        Returns:
            (stats字典, 解析结果列表) — stats 包含 parsed/created/updated/deleted

        Raises:
            WorkspaceNotFound: workspace 不存在
        """
```

### 当前 HTTP API（已迁移完成，无需修改）

```
GET    /api/workspaces/{workspace_id}/scan-docs              -> ScanDocList
GET    /api/workspaces/{workspace_id}/scan-docs/{doc_type}   -> ScanDocRead
POST   /api/workspaces/{workspace_id}/scan-docs/reparse      -> ScanDocReparseResponse
```

### 当前 ScanDocument 数据模型（已迁移完成，无需修改）

```python
class ScanDocument(BaseModel, table=True):
    __tablename__ = "scan_documents"
    __table_args__ = (
        Index("ux_scan_docs_workspace_type", "workspace_id", "doc_type", unique=True),
        Index("ix_scan_docs_workspace", "workspace_id"),
    )

    id: uuid.UUID           # PK
    workspace_id: uuid.UUID # FK -> workspaces.id, CASCADE
    doc_type: str           # String(30)
    path: str               # Text
    title: str | None       # String(500)
    exists: bool            # Boolean, default=True
    content: str | None     # Text
    last_modified_at: datetime | None  # DateTime(timezone=True)
```

无 `component_id` 列。

### SpecWorkspaceService 公开接口（已迁移完成，无需修改）

```python
class SpecWorkspaceService:
    def __init__(self, session: AsyncSession) -> None: ...

    async def create(self, workspace_id: uuid.UUID, payload: SpecWorkspaceCreate) -> SpecWorkspace: ...
    async def get(self, workspace_id: uuid.UUID) -> SpecWorkspace: ...
    async def get_by_id(self, spec_workspace_id: uuid.UUID) -> SpecWorkspace: ...
    async def update(self, workspace_id: uuid.UUID, payload: SpecWorkspaceUpdate) -> SpecWorkspace: ...
    async def import_from_repo(self, workspace_id: uuid.UUID) -> SpecWorkspace: ...
    async def sync(self, workspace_id: uuid.UUID) -> SpecWorkspace: ...
    async def update_sync_status(self, workspace_id: uuid.UUID, payload: SyncStatusUpdate) -> SpecWorkspace: ...
```

所有方法以 `workspace_id` 为查询键，无 `component_id` 引用。

### SpecBootstrapService 公开接口（已迁移完成，无需修改）

```python
class SpecBootstrapService:
    def __init__(self, session: AsyncSession) -> None: ...

    async def bootstrap(self, workspace_id: uuid.UUID, user_id: uuid.UUID) -> dict:
        """
        控制流：
        1. spec_ws = _get_spec_workspace(workspace_id)  -- 通过 SpecWorkspace.workspace_id 查询
        2. workspace = session.get(Workspace, workspace_id)  -- 直接 PK 查询
        3. spec_root = Path(spec_ws.spec_root)
        4. code_root = Path(workspace.root_path)
        5. 创建 AgentRun + 执行 Agent
        6. SpecValidator.validate(spec_root)
        7. 更新 sync_status + 写 AuditLog
        """
```

## 边界处理

1. **workspace 无 component_key**: `reparse()` 中 `getattr(workspace, "component_key", None)` 返回 None 时，返回空 stats `{"parsed": 0, "created": 0, "updated": 0, "deleted": 0}` 和空 `results: list[ScanDocsResult]`。不抛异常，这是合法场景。

2. **workspace 不存在或已软删除**: `WorkspaceService.get()` 内部检查 `deleted_at is not None`，抛出 `WorkspaceNotFound`（404）。ScanDocsService 和 SpecWorkspaceService 不额外处理，直接向上传播。

3. **SpecWorkspace 不存在**: `SpecBootstrapService._get_spec_workspace()` 查询 `SpecWorkspace.workspace_id == workspace_id`，返回 None 时抛 `SpecWorkspaceNotFound`。这是预期行为，不静默吞掉。

4. **重复 reparse 幂等性**: `(workspace_id, doc_type)` 唯一索引 `ux_scan_docs_workspace_type` 保证幂等。第二次 reparse 通过 `existing_by_type` 字典匹配已有行并执行 `_apply_parsed` 更新，不会创建重复行。

5. **doc_type 不存在**: `get()` 查询不到记录时抛 `ScanDocNotFound`（code=`HTTP_404_SCAN_DOC_NOT_FOUND`），前端可区分"该 doc_type 不存在"和"workspace 不存在"。

6. **parser 不变**: `ScanDocsParser.parse_component(sillyspec_root, component_key)` 的签名和实现完全不变。调用方从 `workspace.component_key` 传参。

7. **不修改传入参数**: `_apply_parsed()` 只修改 `row` 对象的属性（path/title/exists/content/last_modified_at），不修改 `parsed_doc`。`_build_row()` 创建新的 `ScanDocument` 实例，不修改 `ParsedDoc`。

8. **reparse 中 exists=False 的行不删除**: 当文件从磁盘消失后，reparse 将已有行的 `exists` 设为 `False`、`content` 设为 `None`、`title` 设为 `None`，但保留数据库行。这是 placeholder 语义，避免丢失 `doc_type` 的占位记录。

## 非目标

- **不修改 ScanDocsParser**: parser 的文件系统解析逻辑完全不变，只是调用方传参来源从 component 改为 workspace。
- **不修改 SpecWorkspaceService 或 SpecBootstrapService**: 这两个服务已经使用 `workspace_id` 查询，无需改动。
- **不写 Alembic 迁移**: 数据库迁移脚本属于 task-01 的范围。
- **不改前端**: 前端 scan-docs 页面适配属于单独的前端任务。
- **不实现全量 reparse API**: 全量 reparse（遍历所有 workspace）不在本任务范围内。
- **不修改 `reparse()` 使用 `SpecWorkspace.spec_root`**: 当前 `reparse()` 直接使用 `Workspace.root_path`，未来若需区分 spec_root 和 code_root，属于后续任务。
- **不新增测试文件**: 现有测试已覆盖 workspace-only 语义，只需验证通过。

## 参考

| 文档/文件 | 路径 | 关联 |
|---|---|---|
| 设计文档 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` | ADR-02（Workspace 是唯一基本单元） |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` | Wave 2, task-07 |
| Workspace 模型 | `backend/app/modules/workspace/model.py` | 含 `component_key` 等 Component 元数据字段 |
| WorkspaceService | `backend/app/modules/workspace/service.py` | `get()` 检查 `deleted_at` |
| SpecWorkspace 模型 | `backend/app/modules/spec_workspace/model.py` | `workspace_id` FK 1:1 关联 |
| ScanDocument 模型 | `backend/app/modules/scan_docs/model.py` | 已无 `component_id` 列 |
| ScanDocsService | `backend/app/modules/scan_docs/service.py` | 已使用 `WorkspaceService` |
| ScanDocsParser | `backend/app/modules/scan_docs/parser.py` | 不变 |
| 错误定义 | `backend/app/core/errors.py` | `ScanDocNotFound`, `WorkspaceNotFound`, `SpecWorkspaceNotFound` |

## TDD 步骤

本任务为验证任务，代码已在之前的 commit 中完成迁移。TDD 步骤为确认性步骤：

### Step 1: 静态验证 — grep 残留引用

```bash
cd backend
grep -rn "ComponentService\|ProjectComponent\|component_service\|COMPONENT_READ\|COMPONENT_WRITE" \
  app/modules/scan_docs/ app/modules/spec_workspace/
# 预期: 无输出
```

对 `component_id` 单独检查（排除 `workspace_id` 中的匹配）：

```bash
cd backend
grep -rn "component_id" app/modules/scan_docs/ app/modules/spec_workspace/
# 预期: 无输出
```

### Step 2: 运行 scan_docs 测试

```bash
cd backend && python -m pytest app/modules/scan_docs/tests/ -v
```

预期全部通过。关键测试：
- `test_service.py::TestListDocsRequiresWorkspace`
- `test_service.py::TestListDocsReturnsEmpty`
- `test_service.py::TestListDocsReturnsExisting`
- `test_service.py::TestGetDocByType`
- `test_service.py::TestGetDocNotFound`
- `test_service.py::TestGetDocWorkspaceNotFound`
- `test_service.py::TestReparseNoComponentKey`
- `test_service.py::TestReparseCreatesDocs`
- `test_service.py::TestReparseUpdatesDocs`
- `test_service.py::TestReparseIdempotent`
- `test_service.py::TestReparseRemovesDeletedFiles`
- `test_router.py::test_list_empty_before_reparse`
- `test_router.py::test_reparse_returns_ok`
- `test_router.py::test_no_auth_returns_401`
- `test_router.py::test_unknown_workspace_returns_404`

### Step 3: 运行 spec_workspace 测试

```bash
cd backend && python -m pytest app/modules/spec_workspace/tests/ -v
```

### Step 4: 全量回归

```bash
cd backend && python -m pytest -v
```

### Step 5: 发现残留时修复

如果 Step 1 发现残留引用，修复对应文件后重新运行测试。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | grep `scan_docs/` 目录中的 `ComponentService` / `ProjectComponent` / `component_service` / `component_id` | 无匹配输出 |
| AC-02 | grep `spec_workspace/` 目录中的 `ComponentService` / `ProjectComponent` / `component_service` / `component_id` | 无匹配输出 |
| AC-03 | 检查 `ScanDocsService.__init__` 签名 | 参数为 `workspace_service: WorkspaceService`，无 `component_service` |
| AC-04 | 检查 `ScanDocument` 模型 | 无 `component_id` 列定义，索引为 `ux_scan_docs_workspace_type(workspace_id, doc_type)` |
| AC-05 | 检查 `ScanDocRead` / `ScanDocSummary` schema | 含 `workspace_id` 字段，无 `component_id` |
| AC-06 | 检查 router.py 路由前缀和路径 | 前缀为 `/workspaces/{workspace_id}`，无 `/components/` 路径段 |
| AC-07 | 检查 router.py 权限 | 使用 `Permission.WORKSPACE_READ` / `Permission.WORKSPACE_WRITE`，无 `COMPONENT_READ` / `COMPONENT_WRITE` |
| AC-08 | 运行 `pytest app/modules/scan_docs/tests/ -v` | 全部通过，0 failures |
| AC-09 | 运行 `pytest app/modules/spec_workspace/tests/ -v` | 全部通过，0 failures |
| AC-10 | 运行 `pytest -v` 全量回归 | 无新增失败用例 |
| AC-11 | 检查 `reparse()` 中 `component_key` 的获取方式 | 使用 `getattr(workspace, "component_key", None)`，从 Workspace 模型获取 |
| AC-12 | 检查 `reparse()` 的 sillyspec_root 来源 | 使用 `Path(workspace.root_path)`，无 `component` 中间层 |
