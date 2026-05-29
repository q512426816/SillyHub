---
id: task-04
title: SpecWorkspace/ScanDocs 适配 — 适配新 Workspace 模型
priority: P1
estimated_hours: 3
depends_on: [task-01]
blocks: [task-07]
allowed_paths:
  - backend/app/modules/spec_workspace/service.py
  - backend/app/modules/spec_workspace/bootstrap.py
  - backend/app/modules/scan_docs/service.py
  - backend/app/modules/scan_docs/tests/
author: qinyi
created_at: 2026-05-28 16:25:00
---

# task-04: SpecWorkspace/ScanDocs 适配 — 适配新 Workspace 模型

## 背景

根据 ADR-07（design.md），Workspace 是唯一基本单元，`project_components` 表将被删除。当前 `scan_docs/service.py` 和 `spec_workspace/service.py` + `bootstrap.py` 仍然依赖 `ComponentService` 或通过 `component_id` 外键关联到 `project_components` 表。

本任务的核心目标：将这两个模块从 Component 模型迁移到纯 Workspace 模型，消除对 `ComponentService`、`ProjectComponent`、`component_id` 的所有依赖。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/scan_docs/service.py` | 修改 | 移除 ComponentService 依赖，`component_id` 改为 `workspace_id`（即独立 Workspace 的 id） |
| `backend/app/modules/scan_docs/model.py` | 修改 | `component_id` FK 改为 `workspace_id` FK 指向 workspaces 表 |
| `backend/app/modules/scan_docs/schema.py` | 修改 | DTO 中 `component_id` 字段改为 `workspace_id` |
| `backend/app/modules/scan_docs/router.py` | 修改 | 路由从 `/components/{component_id}/scan-docs` 改为 `/workspaces/{workspace_id}/scan-docs` |
| `backend/app/modules/scan_docs/parser.py` | 修改 | `parse_component` 方法的 `component_key` 参数改为从 Workspace 的 `component_key` 字段获取 |
| `backend/app/modules/spec_workspace/service.py` | 无实质修改 | 已使用 `workspace_id` 查询，无需改动（验证兼容性即可） |
| `backend/app/modules/spec_workspace/bootstrap.py` | 无实质修改 | 已使用 `workspace_id` 查询，需验证 Workspace 新字段兼容性 |
| `backend/app/modules/scan_docs/tests/test_router.py` | 修改 | 适配新路由路径和 fixture |
| `backend/app/modules/scan_docs/tests/test_parser.py` | 修改 | 适配新参数名 |
| `backend/app/modules/scan_docs/tests/test_service.py` | 新增 | 添加 ScanDocsService 的单元测试 |

## 实现要求

### IR-01: ScanDocsService 移除 ComponentService 依赖

**当前状态**: `ScanDocsService.__init__` 接收 `component_service: ComponentService`，`list_()` 和 `get()` 方法需要先调用 `self._component_service.get(workspace_id, component_id)` 验证 component 存在性。

**目标状态**: 移除 `component_service` 参数。所有 `component_id` 替换为 `workspace_id`（指独立 Workspace 的 id）。使用 `WorkspaceService.get()` 验证 workspace 存在性。

**具体变更**:

```python
# scan_docs/service.py — 构造函数
class ScanDocsService:
    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ScanDocsParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ScanDocsParser()
        self._workspace_service = workspace_service or WorkspaceService(session)
```

### IR-02: ScanDocsService.list_() 简化

**当前签名**: `async def list_(self, workspace_id: uuid.UUID, component_id: uuid.UUID) -> tuple[list[ScanDocument], int]`

**目标签名**: `async def list_(self, workspace_id: uuid.UUID) -> tuple[list[ScanDocument], int]`

**实现逻辑**:

```python
async def list_(self, workspace_id: uuid.UUID) -> tuple[list[ScanDocument], int]:
    await self._workspace_service.get(workspace_id)
    stmt = (
        select(ScanDocument)
        .where(col(ScanDocument.workspace_id) == workspace_id)
        .order_by(col(ScanDocument.doc_type).asc())
    )
    items = list((await self._session.execute(stmt)).scalars().all())
    return items, len(items)
```

### IR-03: ScanDocsService.get() 简化

**当前签名**: `async def get(self, workspace_id: uuid.UUID, component_id: uuid.UUID, doc_type: str) -> ScanDocument`

**目标签名**: `async def get(self, workspace_id: uuid.UUID, doc_type: str) -> ScanDocument`

**实现逻辑**:

```python
async def get(self, workspace_id: uuid.UUID, doc_type: str) -> ScanDocument:
    await self._workspace_service.get(workspace_id)
    stmt = (
        select(ScanDocument)
        .where(col(ScanDocument.workspace_id) == workspace_id)
        .where(col(ScanDocument.doc_type) == doc_type)
    )
    doc = (await self._session.execute(stmt)).scalars().first()
    if doc is None:
        raise ScanDocNotFound(
            f"Scan doc '{doc_type}' not found for this workspace.",
            details={
                "workspace_id": str(workspace_id),
                "doc_type": doc_type,
            },
        )
    return doc
```

注意：将 `ComponentNotFound` 替换为 `ScanDocNotFound`（已在 errors.py 中定义）。

### IR-04: ScanDocsService.reparse() 移除 ComponentService 依赖

**当前逻辑**: 调用 `self._component_service.list_(workspace_id)` 获取所有 component，对每个 component 调用 `self._parser.parse_component(sillyspec_root, comp.component_key)`。

**目标逻辑**: 获取 workspace 列表中所有 workspace（或接受一个 workspace_id 列表参数），对每个 workspace 使用其 `component_key` 字段调用 parser。

**关键变更**: reparse 需要处理"哪些 workspace 要 reparse"。有两种场景：
1. **单 workspace reparse**: 只 reparse 指定 workspace 的 scan docs
2. **全量 reparse**: 遍历所有 workspace，对有 `component_key` 的 workspace 执行 reparse

**方案**: 保持 `reparse(workspace_id)` 的单 workspace 语义不变。每次调用只处理一个 workspace 的 scan docs。Router 可以在需要全量时循环调用。

**实现逻辑**:

```python
async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ScanDocsResult]:
    """Reparse scan docs for a single workspace."""
    workspace = await self._workspace_service.get(workspace_id)

    # 确定 sillyspec_root
    sw_stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace.id)
    spec_ws = (await self._session.execute(sw_stmt)).scalars().first()
    if spec_ws and spec_ws.strategy != "repo-native":
        sillyspec_root = Path(spec_ws.spec_root)
    else:
        sillyspec_root = Path(workspace.root_path)

    # 使用 workspace 的 component_key（由 task-01 合并到 Workspace 模型）
    component_key = getattr(workspace, "component_key", None)
    if component_key is None:
        # 无 component_key 的 workspace 不解析 scan docs
        return {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, ScanDocsResult(component_key="")

    result = self._parser.parse_component(sillyspec_root, component_key)
    stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0}
    stats["parsed"] = len([d for d in result.docs if d.exists])

    # Fetch existing rows for this workspace
    existing = await self._fetch_existing(workspace_id=workspace_id)
    existing_by_type = {d.doc_type: d for d in existing}

    for parsed_doc in result.docs:
        if parsed_doc.doc_type == "OTHER":
            continue
        if parsed_doc.exists:
            if parsed_doc.doc_type in existing_by_type:
                row = existing_by_type[parsed_doc.doc_type]
                self._apply_parsed(row, parsed_doc, workspace_id=workspace_id)
                stats["updated"] += 1
            else:
                row = self._build_row(parsed_doc, workspace_id=workspace_id)
                self._session.add(row)
                stats["created"] += 1
        elif parsed_doc.doc_type in existing_by_type:
            row = existing_by_type[parsed_doc.doc_type]
            row.exists = False
            row.content = None
            row.title = None
        else:
            row = self._build_row(parsed_doc, workspace_id=workspace_id)
            self._session.add(row)
            stats["created"] += 1

    await self._sync_other_docs(
        workspace_id=workspace_id,
        parsed_docs=result.docs,
        stats=stats,
    )

    await self._session.commit()
    log.info("scan_docs.reparsed", workspace_id=str(workspace_id), **stats)
    return stats, result
```

注意返回值从 `list[ScanDocsResult]` 简化为单个 `ScanDocsResult`。

### IR-05: ScanDocument 模型变更

**当前**: `component_id` 字段 FK 指向 `project_components.id`

**目标**: 移除 `component_id` 字段。`workspace_id` 已经存在且 FK 指向 `workspaces.id`，成为唯一定位字段。

**唯一索引变更**: 从 `ux_scan_docs_component_type(component_id, doc_type)` 改为 `ux_scan_docs_workspace_type(workspace_id, doc_type)`

```python
# scan_docs/model.py
class ScanDocument(BaseModel, table=True):
    __tablename__ = "scan_documents"
    __table_args__ = (
        Index(
            "ux_scan_docs_workspace_type",
            "workspace_id",
            "doc_type",
            unique=True,
        ),
        Index("ix_scan_docs_workspace", "workspace_id"),
    )

    # 移除 component_id 字段
    # workspace_id 保留，成为主定位字段
    id: uuid.UUID = ...
    workspace_id: uuid.UUID = ...  # 保留
    doc_type: str = ...
    # 其余字段不变
```

### IR-06: ScanDocs Schema 变更

**scan_docs/schema.py**:

```python
class ScanDocRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID   # 替换 component_id
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    content: str | None = None
    last_modified_at: datetime | None = None

class ScanDocSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    workspace_id: uuid.UUID   # 替换 component_id
    doc_type: str
    path: str
    title: str | None = None
    exists: bool = True
    last_modified_at: datetime | None = None
```

### IR-07: ScanDocs Router 路由变更

**当前路由**:
- `GET /workspaces/{workspace_id}/components/{component_id}/scan-docs`
- `GET /workspaces/{workspace_id}/components/{component_id}/scan-docs/{doc_type}`
- `POST /workspaces/{workspace_id}/scan-docs/reparse`

**目标路由**:
- `GET /workspaces/{workspace_id}/scan-docs`
- `GET /workspaces/{workspace_id}/scan-docs/{doc_type}`
- `POST /workspaces/{workspace_id}/scan-docs/reparse` （不变）

**权限**: `Permission.COMPONENT_READ` 改为 `Permission.WORKSPACE_READ`，`Permission.COMPONENT_WRITE` 改为 `Permission.WORKSPACE_WRITE`。

```python
# scan_docs/router.py — 关键变更
router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["scan-docs"])

@router.get("/scan-docs", response_model=ScanDocList)
async def list_scan_docs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ScanDocList:
    service = ScanDocsService(session)
    items, total = await service.list_(workspace_id)
    return ScanDocList(
        items=[ScanDocSummary.model_validate(d) for d in items],
        total=total,
    )

@router.get("/scan-docs/{doc_type}", response_model=ScanDocRead)
async def get_scan_doc(
    workspace_id: uuid.UUID,
    doc_type: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
) -> ScanDocRead:
    service = ScanDocsService(session)
    doc = await service.get(workspace_id, doc_type)
    return ScanDocRead.model_validate(doc)
```

### IR-08: 辅助方法适配

**`_build_row`**: 移除 `component_id` 参数，只用 `workspace_id`

```python
@staticmethod
def _build_row(
    parsed_doc: ParsedDoc,
    *,
    workspace_id: uuid.UUID,
) -> ScanDocument:
    return ScanDocument(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        doc_type=parsed_doc.doc_type,
        path=parsed_doc.path,
        title=parsed_doc.title,
        exists=parsed_doc.exists,
        content=parsed_doc.content,
        last_modified_at=parsed_doc.last_modified_at,
    )
```

**`_fetch_existing`**: 改用 `workspace_id`

```python
async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ScanDocument]:
    stmt = select(ScanDocument).where(
        col(ScanDocument.workspace_id) == workspace_id
    )
    return list((await self._session.execute(stmt)).scalars().all())
```

**`_sync_other_docs`**: 移除 `component_id` 参数，改用 `workspace_id`

```python
async def _sync_other_docs(
    self,
    *,
    workspace_id: uuid.UUID,
    parsed_docs: list[ParsedDoc],
    stats: dict[str, int],
) -> None:
    other_parsed = [d for d in parsed_docs if d.doc_type == "OTHER"]
    existing = await self._fetch_existing(workspace_id)
    existing_other = [d for d in existing if d.doc_type == "OTHER"]
    existing_paths = {d.path for d in existing_other}
    parsed_paths = {d.path for d in other_parsed}

    for doc in other_parsed:
        if doc.path not in existing_paths:
            row = self._build_row(doc, workspace_id=workspace_id)
            self._session.add(row)

    for row in existing_other:
        if row.path not in parsed_paths:
            await self._session.delete(row)
            stats["deleted"] += 1
```

**`_apply_parsed`**: 移除多余参数，只保留必要字段

```python
@staticmethod
def _apply_parsed(
    row: ScanDocument,
    parsed_doc: ParsedDoc,
) -> None:
    row.path = parsed_doc.path
    row.title = parsed_doc.title
    row.exists = parsed_doc.exists
    row.content = parsed_doc.content
    row.last_modified_at = parsed_doc.last_modified_at
```

## 接口定义

### ScanDocsService 公开接口（改后）

```python
class ScanDocsService:
    """List, fetch, and reparse scan documents for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ScanDocsParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None: ...

    async def list_(self, workspace_id: uuid.UUID) -> tuple[list[ScanDocument], int]:
        """列出指定 workspace 的所有 scan docs。

        Args:
            workspace_id: 目标 workspace 的 UUID

        Returns:
            (scan_docs列表, 总数)

        Raises:
            WorkspaceNotFound: workspace 不存在或已删除
        """

    async def get(self, workspace_id: uuid.UUID, doc_type: str) -> ScanDocument:
        """获取指定 workspace 的单个 scan doc（按 doc_type）。

        Args:
            workspace_id: 目标 workspace 的 UUID
            doc_type: 文档类型，如 "ARCHITECTURE"

        Returns:
            ScanDocument 记录

        Raises:
            WorkspaceNotFound: workspace 不存在
            ScanDocNotFound: 该 doc_type 的记录不存在
        """

    async def reparse(self, workspace_id: uuid.UUID) -> tuple[dict[str, int], ScanDocsResult]:
        """重新解析指定 workspace 的 scan docs。

        从 SpecWorkspace.spec_root 或 Workspace.root_path 读取文件系统，
        与 DB 现有记录做 diff-based UPSERT。

        Args:
            workspace_id: 目标 workspace 的 UUID

        Returns:
            (stats字典, 解析结果) — stats 包含 parsed/created/updated/deleted

        Raises:
            WorkspaceNotFound: workspace 不存在

        Note:
            如果 workspace 无 component_key 字段，返回空 stats 和空 result。
        """
```

### ScanDocsService 私有接口（改后）

```python
    async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ScanDocument]:
        """获取指定 workspace 的所有现有 ScanDocument 行。"""

    async def _sync_other_docs(
        self, *, workspace_id: uuid.UUID, parsed_docs: list[ParsedDoc], stats: dict[str, int],
    ) -> None:
        """同步 OTHER 类型文档（可以有多个文件）。"""

    @staticmethod
    def _build_row(parsed_doc: ParsedDoc, *, workspace_id: uuid.UUID) -> ScanDocument:
        """从 ParsedDoc 构建 ScanDocument 行（不 add 到 session）。"""

    @staticmethod
    def _apply_parsed(row: ScanDocument, parsed_doc: ParsedDoc) -> None:
        """将 ParsedDoc 的内容应用到现有 ScanDocument 行。"""
```

### HTTP API（改后）

```
GET    /api/workspaces/{workspace_id}/scan-docs              → ScanDocList
GET    /api/workspaces/{workspace_id}/scan-docs/{doc_type}   → ScanDocRead
POST   /api/workspaces/{workspace_id}/scan-docs/reparse      → ScanDocReparseResponse
```

### ScanDocument 数据模型（改后）

```python
# 移除字段: component_id
# 保留字段: id, workspace_id, doc_type, path, title, exists, content, last_modified_at
# 索引变更:
#   删除: ix_scan_docs_component, ux_scan_docs_component_type
#   新增: ux_scan_docs_workspace_type(workspace_id, doc_type) UNIQUE
#   保留: ix_scan_docs_workspace(workspace_id)
```

## 边界处理

1. **workspace 无 component_key**: `reparse()` 遇到没有 `component_key` 字段的 Workspace 时，返回空 stats `{"parsed": 0, "created": 0, "updated": 0, "deleted": 0}` 和空的 `ScanDocsResult`，不抛异常。这是合法场景：某些 Workspace 可能不是从组件 YAML 创建的。

2. **workspace 不存在或已软删除**: `WorkspaceService.get()` 会抛出 `WorkspaceNotFound`（404），ScanDocsService 不需要额外处理，直接向上传播。

3. **SpecWorkspace 不存在**: `reparse()` 中查询 `SpecWorkspace` 时可能返回 None。此时 fallback 到 `Workspace.root_path`。这与当前 `component_service.reparse()` 中的逻辑一致，无需修改。

4. **重复 reparse 幂等性**: `reparse()` 通过 `(workspace_id, doc_type)` 唯一索引保证幂等。第二次 reparse 会 update 已有行而非重复创建。移除 `component_id` 不影响此逻辑。

5. **doc_type 不存在时返回 placeholder**: `get()` 查询不到记录时抛出 `ScanDocNotFound`。前端需要区分"该 doc_type 真的不存在"和"该 workspace 不存在"。解决方案：前端先调 `list_()` 获取所有 docs（包含 `exists=False` 的 placeholder），或者 router 层在 `get()` 中对 `exists=False` 的行正常返回而非抛 404。

6. **数据迁移兼容**: task-01 的 Alembic 迁移需要处理 `scan_documents` 表的 `component_id` 列。方案：在迁移中 drop `component_id` FK 和索引，添加新的唯一索引 `ux_scan_docs_workspace_type`。本任务不写迁移脚本（属于 task-01 范围），但需要在此处明确迁移要求供 task-01 参考。

7. **parser 不变**: `ScanDocsParser.parse_component(sillyspec_root, component_key)` 的签名和实现不变。调用方从 `comp.component_key` 改为 `workspace.component_key` 传参即可。

## 非目标

- **不修改 SpecWorkspaceService**: 该服务已经使用 `workspace_id` 作为唯一查询键，无需改动。只需在验收时确认与 task-01 新增的 Workspace 字段兼容。
- **不修改 SpecBootstrapService**: bootstrap.py 已经通过 `workspace_id` 查询 SpecWorkspace 和 Workspace，无需改动。
- **不写 Alembic 迁移**: 数据库迁移脚本属于 task-01 的范围。本任务只提供迁移需求说明。
- **不改前端**: 前端的 scan-docs 页面适配属于单独的前端任务。
- **不改 parser.py 的文件系统解析逻辑**: `ScanDocsParser` 的内部逻辑完全不变，只是调用方传参来源从 component 改为 workspace。
- **不实现全量 reparse API**: 全量 reparse（遍历所有 workspace）不在本任务范围内，当前保持单 workspace reparse 语义。

## 参考

| 文档/文件 | 路径 | 关联 |
|---|---|---|
| 设计文档 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` | ADR-07, ADR-08 |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` | Wave 2, task-07（plan 中编号） |
| Workspace 模型 | `backend/app/modules/workspace/model.py` | task-01 将吸收 component 元数据字段 |
| SpecWorkspace 模型 | `backend/app/modules/spec_workspace/model.py` | 1:1 关联 Workspace，无需改动 |
| ScanDocument 模型 | `backend/app/modules/scan_docs/model.py` | 需移除 component_id FK |
| ComponentService | `backend/app/modules/component/service.py` | 被移除的依赖 |
| 错误定义 | `backend/app/core/errors.py` | ScanDocNotFound 已定义 |
| ScanDocsParser | `backend/app/modules/scan_docs/parser.py` | 不变，仅调用方传参来源变更 |

## TDD 步骤

### Step 1: 修改 ScanDocument 模型（RED）

1. 编辑 `scan_docs/model.py`：移除 `component_id` 字段，修改 `__table_args__` 中的索引
2. 此时所有现有测试应该编译失败（因为 schema 不匹配）

### Step 2: 修改 ScanDocs Schema（RED）

1. 编辑 `scan_docs/schema.py`：`ScanDocRead` 和 `ScanDocSummary` 中 `component_id` 改为 `workspace_id`
2. 确认现有测试仍报错

### Step 3: 编写新的 Service 单元测试（RED）

创建 `backend/app/modules/scan_docs/tests/test_service.py`：

```python
"""Tests for ScanDocsService — adapted to workspace-only model."""

# 测试用例清单：
# - TestListDocsRequiresWorkspace: list_() 对不存在的 workspace_id 抛 WorkspaceNotFound
# - TestListDocsReturnsEmpty: workspace 存在但无 scan docs 时返回 ([], 0)
# - TestListDocsReturnsExisting: workspace 有 docs 时返回正确列表
# - TestGetDocByType: get() 返回正确的 ScanDocument
# - TestGetDocNotFound: get() 对不存在的 doc_type 抛 ScanDocNotFound
# - TestGetDocWorkspaceNotFound: get() 对不存在的 workspace 抛 WorkspaceNotFound
# - TestReparseNoComponentKey: workspace 无 component_key 时返回空 stats
# - TestReparseCreatesDocs: reparse 从文件系统创建新的 ScanDocument 行
# - TestReparseUpdatesDocs: reparse 更新已有行的内容
# - TestReparseIdempotent: 两次 reparse 结果一致（幂等）
# - TestReparseRemovesDeletedFiles: 文件从磁盘删除后 reparse 标记 exists=False
```

### Step 4: 实现 ScanDocsService 变更（GREEN）

1. 修改构造函数：移除 `component_service`，保留 `workspace_service`
2. 修改 `list_()`：移除 `component_id` 参数，用 `workspace_id` 查询
3. 修改 `get()`：移除 `component_id` 参数，用 `workspace_id` + `doc_type` 查询
4. 修改 `reparse()`：移除 component 遍历，改为单 workspace 解析
5. 修改所有辅助方法：移除 `component_id` 参数

### Step 5: 修改 Router（GREEN）

1. 修改路由路径：`/components/{component_id}/scan-docs` → `/scan-docs`
2. 修改权限：`COMPONENT_READ` → `WORKSPACE_READ`，`COMPONENT_WRITE` → `WORKSPACE_WRITE`
3. 修改 handler 签名：移除 `component_id` 参数

### Step 6: 修改现有 Router 测试（GREEN）

1. 编辑 `test_router.py`：
   - `workspace_with_docs` fixture 改为直接创建 workspace（不再依赖 component reparse）
   - 所有 API 路径从 `/components/{id}/scan-docs` 改为 `/scan-docs`
   - 移除 `silly_id` / `admin_ui_id` 的使用，改用 `ws_id`

### Step 7: 运行全部测试确认通过

```bash
cd backend && python -m pytest app/modules/scan_docs/tests/ -v
cd backend && python -m pytest app/modules/spec_workspace/tests/ -v
cd backend && python -m pytest -v  # 全量回归
```

### Step 8: 验证 SpecWorkspaceService 兼容性

确认 `spec_workspace/service.py` 和 `bootstrap.py` 中的以下代码路径仍然正常工作：
- `SpecWorkspaceService.get(workspace_id)` — 通过 `SpecWorkspace.workspace_id` 查询
- `SpecBootstrapService.bootstrap(workspace_id, user_id)` — 通过 `Workspace` 模型的 `root_path` 字段
- 确认 `workspace.root_path` 在 task-01 后仍可用（workspace 模型保留了 `root_path`）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `ScanDocsService` 构造函数不含 `component_service` 参数 | import 中无 `ComponentService`，`__init__` 无 `component_service` 形参 |
| AC-02 | `list_(workspace_id)` 返回正确结果 | 对有 scan docs 的 workspace 返回正确的 `list[ScanDocument]` 和总数 |
| AC-03 | `get(workspace_id, doc_type)` 返回正确结果 | 返回匹配的 `ScanDocument`，`doc_type` 不存在时抛 `ScanDocNotFound` |
| AC-04 | `reparse(workspace_id)` 正常工作 | 从文件系统读取并正确 upsert ScanDocument 行，stats 数字正确 |
| AC-05 | workspace 无 `component_key` 时 reparse 不报错 | 返回空 stats `{"parsed": 0, ...}` 和空 `ScanDocsResult`，无异常 |
| AC-06 | `ScanDocument` 模型无 `component_id` 字段 | model.py 中无 `component_id` 列定义，无 `project_components` FK |
| AC-07 | `ScanDocRead` / `ScanDocSummary` schema 含 `workspace_id` | schema.py 中 DTO 使用 `workspace_id` 而非 `component_id` |
| AC-08 | 路由路径不含 `/components/` | router.py 中无 `component_id` 路径参数 |
| AC-09 | 权限使用 `WORKSPACE_READ` / `WORKSPACE_WRITE` | router.py 中所有 `require_permission` 使用 workspace 权限 |
| AC-10 | 全部 scan_docs 测试通过 | `pytest app/modules/scan_docs/tests/ -v` 全绿 |
| AC-11 | 全部 spec_workspace 测试通过 | `pytest app/modules/spec_workspace/tests/ -v` 全绿 |
| AC-12 | 无 `ComponentService` / `ProjectComponent` 残留引用 | scan_docs/ 和 spec_workspace/ 目录中 grep 不到 `component_service`、`ComponentService`、`ProjectComponent`、`component_id` |
| AC-13 | 全量 pytest 回归通过 | `pytest` 无新增失败用例 |
