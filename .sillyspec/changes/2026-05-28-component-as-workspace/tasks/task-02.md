---
id: task-02
title: WorkspaceRelation 模块 — CRUD + 拓扑查询
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-05, task-06]
allowed_paths:
  - backend/app/modules/workspace/relation_model.py
  - backend/app/modules/workspace/relation_schema.py
  - backend/app/modules/workspace/relation_service.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/topology.py
  - backend/app/modules/workspace/tests/test_relation_router.py
  - backend/app/core/errors.py
author: qinyi
created_at: 2026-05-28 16:25:00
---

# Task-02: WorkspaceRelation 模块 — CRUD + 拓扑查询

## 1. 上下文

**文档依据：**
- 设计文档：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md` (ADR-08)
- 实现计划：`.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` (Wave 2)
- 现有模型参考：`backend/app/modules/component/model.py` (`ComponentRelation` — 将被替换)
- 现有路由模式：`backend/app/modules/workspace/router.py`

**目标：** 将 `component_relations` 表替换为 `workspace_relations` 表，实现完整 CRUD + 全局拓扑图查询。source/target 都指向 `workspaces` 表，不再有 `workspace_id` 范围列。允许循环依赖，禁止自环。

## 2. 修改文件清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/relation_model.py` | **新增** | `WorkspaceRelation` SQLModel 表定义 |
| `backend/app/modules/workspace/relation_schema.py` | **新增** | Pydantic DTO（Create / Read / List / Topology） |
| `backend/app/modules/workspace/relation_service.py` | **新增** | CRUD + 校验逻辑 |
| `backend/app/modules/workspace/topology.py` | **新增** | 全局拓扑图构建 |
| `backend/app/modules/workspace/router.py` | **修改** | 新增 4 个端点（relations CRUD + topology） |
| `backend/app/modules/workspace/tests/test_relation_router.py` | **新增** | 全量 HTTP 级测试 |
| `backend/app/core/errors.py` | **修改** | 新增 `RelationNotFound` / `RelationSelfLoop` / `RelationDuplicate` 错误类 |

注意：`workspace_relations` 表的 Alembic 迁移脚本由 task-01 负责。本任务只写 ORM 模型和代码逻辑，假设迁移已经落地。

## 3. 实现要求

### 3.1 relation_model.py — WorkspaceRelation 表

```python
"""workspace_relations table — directed graph between workspaces.

Replaces the old component_relations table (ADR-08).
source and target both reference workspaces.id.
Cycles are allowed; self-loops are prevented at the application level.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class WorkspaceRelation(BaseModel, table=True):
    """Directed edge between two workspaces in the global graph."""

    __tablename__ = "workspace_relations"
    __table_args__ = (
        Index(
            "ux_workspace_relations_triplet",
            "source_id",
            "target_id",
            "relation_type",
            unique=True,
        ),
        Index("ix_workspace_relations_source", "source_id"),
        Index("ix_workspace_relations_target", "target_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    source_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            # FK defined in Alembic migration (task-01)
            nullable=False,
        ),
    )
    target_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            nullable=False,
        ),
    )
    relation_type: str = Field(sa_column=Column(String(50), nullable=False))
    description: str | None = Field(default=None, sa_column=Column(String, nullable=True))
    created_at: datetime = Field(
        default_factory=lambda: datetime.utcnow(),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
```

关键设计点：
- 无 `workspace_id` 列（与旧 `component_relations` 不同，因为关系是全局的而非属于某个 workspace）
- UQ 约束 `(source_id, target_id, relation_type)` 保证同一对节点同类型只有一条
- 自环校验在 service 层做（DB CHECK constraint 由 task-01 的迁移负责，代码也做双重保险）
- FK 到 `workspaces.id` 的 CASCADE 在迁移脚本中声明，ORM 层不声明以避免模块间导入耦合（与现有 `ComponentRelation` 模式一致）

### 3.2 relation_schema.py — Pydantic DTO

定义以下类型：

```python
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

RelationTypeLiteral = Literal[
    "depends_on",
    "consumes_api_from",
    "tests",
    "publishes_to",
    "documents",
]

VALID_RELATION_TYPES: list[str] = [
    "depends_on",
    "consumes_api_from",
    "tests",
    "publishes_to",
    "documents",
]


class RelationCreate(BaseModel):
    """Request body for POST /api/workspaces/{id}/relations."""
    target_id: uuid.UUID
    relation_type: RelationTypeLiteral
    description: str | None = None


class RelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None
    created_at: datetime


class RelationListResponse(BaseModel):
    outgoing: list[RelationRead]   # source = this workspace
    incoming: list[RelationRead]   # target = this workspace


class TopologyNode(BaseModel):
    """A workspace node in the topology graph."""
    id: uuid.UUID
    name: str
    slug: str
    component_key: str | None


class TopologyEdge(BaseModel):
    """A directed edge in the topology graph."""
    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None


class TopologyResponse(BaseModel):
    """Full topology graph response."""
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]
```

### 3.3 relation_service.py — CRUD + 校验

```python
class RelationService:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_for_workspace(self, workspace_id: uuid.UUID) -> RelationListResponse:
        """Query all outgoing + incoming relations for a workspace."""

    async def create(self, source_id: uuid.UUID, payload: RelationCreate) -> WorkspaceRelation:
        """Create a relation with full validation."""
        # 1. source_id == payload.target_id => raise RelationSelfLoop
        # 2. source workspace must exist (via WorkspaceService.get)
        # 3. target workspace must exist (via session.get)
        # 4. UQ triplet check: query existing, if found raise RelationDuplicate
        # 5. Insert and return

    async def delete(self, relation_id: uuid.UUID) -> WorkspaceRelation:
        """Delete a relation by its id."""
        # 1. Load relation, raise RelationNotFound if missing
        # 2. Delete, commit, return the deleted object (for response)
```

校验规则细节：
1. **自环检查**：`source_id == target_id` 时抛出 `RelationSelfLoop` (400)
2. **存在性检查**：source 和 target workspace 都必须存在且未软删除（复用 `WorkspaceService.get`）
3. **重复检查**：查询 `(source_id, target_id, relation_type)` 是否已存在，存在则抛出 `RelationDuplicate` (409)
4. **relation_type 校验**：由 Pydantic `Literal` 类型保证，非法值直接 422

### 3.4 topology.py — 全局拓扑图构建

```python
class TopologyBuilder:
    """Build the full workspace topology graph."""

    @staticmethod
    async def build(session: AsyncSession) -> TopologyResponse:
        """
        1. SELECT all active workspaces (deleted_at IS NULL)
        2. SELECT all workspace_relations
        3. Assemble TopologyResponse with nodes + edges
        """
```

注意：
- 只返回 active workspace（`deleted_at IS NULL`）作为节点
- 边只包含两端节点都是 active 的（CASCADE 删除保证了软删除 workspace 的边被清掉，但这里做应用层过滤作为双重保险）
- 不做分页（初期数据量小），后续可以加 limit/offset 参数

### 3.5 router.py — 新增端点

在现有 `router = APIRouter(prefix="/workspaces", tags=["workspace"])` 下新增 4 个端点：

#### 端点 1: GET /api/workspaces/{workspace_id}/relations

```python
@router.get("/{workspace_id}/relations", response_model=RelationListResponse)
async def list_relations(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
) -> RelationListResponse:
    """List all outgoing + incoming relations for a workspace."""
    service = RelationService(session)
    return await service.list_for_workspace(workspace_id)
```

- 权限：`WORKSPACE_READ`
- 返回：`RelationListResponse`（含 `outgoing` 和 `incoming` 两个列表）

#### 端点 2: POST /api/workspaces/{workspace_id}/relations

```python
@router.post(
    "/{workspace_id}/relations",
    response_model=RelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_relation(
    workspace_id: uuid.UUID,
    payload: RelationCreate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))],
) -> RelationRead:
    """Create a relation. source_id = workspace_id from path."""
    service = RelationService(session)
    relation = await service.create(workspace_id, payload)
    return RelationRead.model_validate(relation)
```

- 权限：`WORKSPACE_WRITE`
- `source_id` 从 URL path 取（`workspace_id`），`target_id` 和 `relation_type` 从 body 取
- 201 返回

#### 端点 3: DELETE /api/workspaces/relations/{relation_id}

```python
@router.delete(
    "/relations/{relation_id}",
    response_model=RelationRead,
    status_code=status.HTTP_200_OK,
)
async def delete_relation(
    relation_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_ADMIN))],
) -> RelationRead:
    """Delete a relation by id."""
    service = RelationService(session)
    relation = await service.delete(relation_id)
    return RelationRead.model_validate(relation)
```

- 权限：`WORKSPACE_ADMIN`
- 注意 URL pattern：`/workspaces/relations/{relation_id}`（不在 `{workspace_id}` 下）
- 200 返回被删除的 relation 对象

#### 端点 4: GET /api/workspaces/topology

```python
@router.get("/topology", response_model=TopologyResponse)
async def get_topology(
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_READ))],
) -> TopologyResponse:
    """Return the full workspace topology graph."""
    return await TopologyBuilder.build(session)
```

- 权限：`WORKSPACE_READ`
- 路由注册顺序：必须放在 `/{workspace_id}` 路由之前，否则 "topology" 会被当作 UUID 解析报 422
- 实际上因为它没有 `{workspace_id}` 前缀段，可以放在 router 定义的最前面（在 `/{workspace_id}/relations` 之前也可以），但最安全的做法是在 `@router.get("/{workspace_id}")` 之前定义

**重要：路由注册顺序** — `GET /workspaces/topology` 必须定义在 `GET /workspaces/{workspace_id}` 和 `GET /workspaces/{workspace_id}/relations` 之前。FastAPI 按定义顺序匹配路由，`topology` 会被当作 `workspace_id` 参数匹配到。建议把这个端点放在 `scan` 端点之后、`create_workspace` 之前。

### 3.6 errors.py — 新增错误类

在 `# ── Component errors` 区域之前（或之后，但统一在 Workspace 区域附近），新增：

```python
# ── Relation errors ────────────────────────────────────────────────────────


class RelationNotFound(AppError):
    code = "HTTP_404_RELATION_NOT_FOUND"
    http_status = status.HTTP_404_NOT_FOUND


class RelationSelfLoop(AppError):
    code = "HTTP_400_RELATION_SELF_LOOP"
    http_status = status.HTTP_400_BAD_REQUEST


class RelationDuplicate(AppError):
    code = "HTTP_409_RELATION_DUPLICATE"
    http_status = status.HTTP_409_CONFLICT
```

## 4. 接口定义汇总

### API 端点

| 方法 | 路径 | 请求体 | 响应 | 状态码 | 权限 |
|---|---|---|---|---|---|
| GET | `/api/workspaces/{id}/relations` | — | `RelationListResponse` | 200 | `WORKSPACE_READ` |
| POST | `/api/workspaces/{id}/relations` | `RelationCreate` | `RelationRead` | 201 | `WORKSPACE_WRITE` |
| DELETE | `/api/workspaces/relations/{relation_id}` | — | `RelationRead` | 200 | `WORKSPACE_ADMIN` |
| GET | `/api/workspaces/topology` | — | `TopologyResponse` | 200 | `WORKSPACE_READ` |

### 错误响应

| 错误码 | HTTP 状态 | 触发场景 |
|---|---|---|
| `HTTP_400_RELATION_SELF_LOOP` | 400 | source_id == target_id |
| `HTTP_404_RELATION_NOT_FOUND` | 404 | 删除时 relation_id 不存在 |
| `HTTP_404_WORKSPACE_NOT_FOUND` | 404 | source 或 target workspace 不存在/已删除 |
| `HTTP_409_RELATION_DUPLICATE` | 409 | 同一对 (source, target, type) 已存在 |

### 数据结构

**RelationCreate：**
```json
{
  "target_id": "uuid-string",
  "relation_type": "depends_on",
  "description": "optional string"
}
```

**RelationRead：**
```json
{
  "id": "uuid-string",
  "source_id": "uuid-string",
  "target_id": "uuid-string",
  "relation_type": "depends_on",
  "description": "optional string or null",
  "created_at": "ISO-8601"
}
```

**RelationListResponse：**
```json
{
  "outgoing": [RelationRead, ...],
  "incoming": [RelationRead, ...]
}
```

**TopologyResponse：**
```json
{
  "nodes": [
    {"id": "uuid", "name": "api-gateway", "slug": "api-gateway", "component_key": "api-gateway"},
    ...
  ],
  "edges": [
    {"id": "uuid", "source_id": "uuid", "target_id": "uuid", "relation_type": "depends_on", "description": "..."},
    ...
  ]
}
```

## 5. 边界处理

1. **自环禁止**：`source_id == target_id` 时，service 层抛出 `RelationSelfLoop`，不依赖 DB CHECK constraint（代码层是第一道防线，DB 是兜底）。错误消息："Cannot create a self-referencing relation."

2. **Workspace 已软删除**：source 或 target workspace 如果 `deleted_at IS NOT NULL`，`WorkspaceService.get()` 已经会抛 `WorkspaceNotFound`，自然拦截。create 时先用 `WorkspaceService.get(source_id)` 校验 source，再 `session.get(Workspace, target_id)` 并检查 `deleted_at`。

3. **重复关系**：(source_id, target_id, relation_type) 三元组唯一。在 service 层先 SELECT 查询是否存在，存在则抛 `RelationDuplicate`。IntegrityError 也做 catch 转换（与 `WorkspaceService._translate_integrity_error` 模式一致）。

4. **循环依赖合法**：A → B 和 B → A 可以同时存在（不同 relation_type），甚至 A → B（depends_on）和 B → A（consumes_api_from）可以共存。不做 DAG 校验。

5. **删除 Workspace 后关系清理**：task-01 的迁移脚本在 FK 上设置了 `ON DELETE CASCADE`。Workspace 被硬删除时关联的 relation 自动清理。软删除场景下 relation 保留（因为 workspace 可能被 resurrect），但在 topology 查询中过滤掉。

6. **Topology 只含 active workspace**：`TopologyBuilder.build()` 查询 `deleted_at IS NULL` 的 workspace，边也只返回两端都是 active 的。这保证了已删除 workspace 不会出现在拓扑图中。

7. **路由顺序冲突**：`GET /workspaces/topology` 不能放在 `GET /workspaces/{workspace_id}` 之后，否则 FastAPI 会把 "topology" 当作 UUID 参数解析。必须把 topology 端点定义在所有含 `{workspace_id}` 的路由之前。

## 6. 非目标

- 不做分页（初期 workspace 数量少，后续按需加 limit/offset）
- 不做关系更新（relation 没有可变字段，需要改就删了重建）
- 不做批量创建/删除（单条操作足够，批量留给 scanner reparse）
- 不做权限粒度到 relation 级别（复用 WORKSPACE_READ/WRITE/ADMIN）
- 不做拓扑图的子图查询（只提供全局图，后续可加 `?workspace_id=` 过滤）
- 不做图算法（最短路径、连通分量等），只做基础 CRUD + 全图返回

## 7. 参考

| 项目 | 路径 |
|---|---|
| 设计文档 ADR-08 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` |
| 旧 ComponentRelation 模型 | `backend/app/modules/component/model.py` (L82-124) |
| 现有 Workspace router 模式 | `backend/app/modules/workspace/router.py` |
| 现有 Workspace service 模式 | `backend/app/modules/workspace/service.py` |
| 现有 Workspace model | `backend/app/modules/workspace/model.py` |
| 现有 schema DTO 模式 | `backend/app/modules/workspace/schema.py` |
| 错误类模式 | `backend/app/core/errors.py` |
| 权限枚举 | `backend/app/modules/auth/permissions.py` |
| 测试模式 | `backend/app/modules/workspace/tests/test_router.py` |
| BaseModel | `backend/app/models/base.py` |

## 8. TDD 步骤

### Red 阶段（先写测试，全部失败）

**文件：** `backend/app/modules/workspace/tests/test_relation_router.py`

**前置 fixture：** 复用现有 `client` / `auth_headers` fixture（来自 conftest.py），需要创建 2 个 workspace 作为测试数据。

#### 测试 1: 创建关系成功
```
1. 创建 workspace A (POST /api/workspaces)
2. 创建 workspace B (POST /api/workspaces)
3. POST /api/workspaces/{A.id}/relations
   body: {"target_id": B.id, "relation_type": "depends_on", "description": "A depends on B"}
4. 断言 201
5. 断言 response.id 是有效 UUID
6. 断言 response.source_id == A.id
7. 断言 response.target_id == B.id
8. 断言 response.relation_type == "depends_on"
```

#### 测试 2: 创建重复关系返回 409
```
1. 创建 workspace A, B
2. 创建关系 A → B (depends_on) — 成功
3. 再次创建关系 A → B (depends_on) — 同一 triplet
4. 断言 409
5. 断言 response.code == "HTTP_409_RELATION_DUPLICATE"
```

#### 测试 3: 创建自环返回 400
```
1. 创建 workspace A
2. POST /api/workspaces/{A.id}/relations
   body: {"target_id": A.id, "relation_type": "depends_on"}
3. 断言 400
4. 断言 response.code == "HTTP_400_RELATION_SELF_LOOP"
```

#### 测试 4: 创建关系 target 不存在返回 404
```
1. 创建 workspace A
2. POST /api/workspaces/{A.id}/relations
   body: {"target_id": "<random-uuid>", "relation_type": "depends_on"}
3. 断言 404 (WorkspaceNotFound)
```

#### 测试 5: 创建关系 source 不存在返回 404
```
1. POST /api/workspaces/<nonexistent-uuid>/relations
   body: {"target_id": "<random-uuid>", "relation_type": "depends_on"}
2. 断言 404 (WorkspaceNotFound)
```

#### 测试 6: 列出关系包含出边和入边
```
1. 创建 workspace A, B, C
2. 创建关系 A → B (depends_on)
3. 创建关系 C → A (consumes_api_from)
4. GET /api/workspaces/{A.id}/relations
5. 断言 200
6. 断言 outgoing 长度 1, outgoing[0].target_id == B.id
7. 断言 incoming 长度 1, incoming[0].source_id == C.id
```

#### 测试 7: 删除关系成功
```
1. 创建 workspace A, B
2. 创建关系 A → B (depends_on) — 记录 relation_id
3. DELETE /api/workspaces/relations/{relation_id}
4. 断言 200
5. 断言 response.id == relation_id
6. 再次 GET /api/workspaces/{A.id}/relations
7. 断言 outgoing 为空
```

#### 测试 8: 删除不存在的关系返回 404
```
1. DELETE /api/workspaces/relations/<random-uuid>
2. 断言 404
3. 断言 response.code == "HTTP_404_RELATION_NOT_FOUND"
```

#### 测试 9: 拓扑图返回全局图
```
1. 创建 workspace A, B, C
2. 创建关系 A → B (depends_on)
3. 创建关系 B → C (tests)
4. GET /api/workspaces/topology
5. 断言 200
6. 断言 nodes 长度 >= 3
7. 断言 edges 长度 >= 2
8. 断言 edges 中包含 (A→B, depends_on) 和 (B→C, tests)
```

#### 测试 10: 拓扑图不含已删除 workspace
```
1. 创建 workspace A, B, C
2. 创建关系 A → B (depends_on)
3. 软删除 workspace B
4. GET /api/workspaces/topology
5. 断言 nodes 中不包含 B
6. 断言 edges 中不包含涉及 B 的边
```

#### 测试 11: 列出无关系的 workspace 返回空列表
```
1. 创建 workspace A
2. GET /api/workspaces/{A.id}/relations
3. 断言 200
4. 断言 outgoing 为空
5. 断言 incoming 为空
```

#### 测试 12: 同对节点不同关系类型可共存
```
1. 创建 workspace A, B
2. 创建关系 A → B (depends_on) — 成功
3. 创建关系 A → B (consumes_api_from) — 成功
4. 断言 201
5. GET /api/workspaces/{A.id}/relations
6. 断言 outgoing 长度 2
```

### Green 阶段（写实现，全部通过）

按以下顺序实现：

1. 在 `errors.py` 中新增 3 个错误类
2. 创建 `relation_model.py` — WorkspaceRelation 模型
3. 创建 `relation_schema.py` — 全部 DTO
4. 创建 `relation_service.py` — RelationService 类
5. 创建 `topology.py` — TopologyBuilder 类
6. 在 `router.py` 中新增 4 个端点（注意路由顺序）
7. 运行全部测试，确保通过

### Refactor 阶段

- 检查重复代码（如 workspace 存在性校验可抽取为 helper）
- 确认所有 query 使用了正确的索引列
- 确认日志格式与现有 workspace 模块一致

## 9. 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | `relation_model.py` 中 `WorkspaceRelation` 表定义正确，含 `source_id`, `target_id`, `relation_type`, `description`, `created_at` | 代码审查：字段类型、nullable、Index 声明齐全 |
| 2 | `relation_schema.py` 包含 `RelationCreate`, `RelationRead`, `RelationListResponse`, `TopologyNode`, `TopologyEdge`, `TopologyResponse` 全部 DTO | 代码审查 + mypy/pyright 通过 |
| 3 | `POST /api/workspaces/{id}/relations` 能成功创建关系，返回 201 | 测试 1 |
| 4 | 自环请求返回 400 + `HTTP_400_RELATION_SELF_LOOP` | 测试 3 |
| 5 | 重复三元组返回 409 + `HTTP_409_RELATION_DUPLICATE` | 测试 2 |
| 6 | source 或 target 不存在返回 404 | 测试 4 + 测试 5 |
| 7 | `GET /api/workspaces/{id}/relations` 正确返回 outgoing + incoming | 测试 6 |
| 8 | `DELETE /api/workspaces/relations/{id}` 删除成功，关系从列表中消失 | 测试 7 |
| 9 | 删除不存在的 relation 返回 404 + `HTTP_404_RELATION_NOT_FOUND` | 测试 8 |
| 10 | `GET /api/workspaces/topology` 返回完整图结构 | 测试 9 |
| 11 | 拓扑图中不含已软删除的 workspace 及其边 | 测试 10 |
| 12 | 同对节点不同 relation_type 可共存 | 测试 12 |
| 13 | 无关系的 workspace 查询返回空列表 | 测试 11 |
| 14 | 所有端点有正确的权限保护 | 测试：无 auth headers 时返回 401 |
| 15 | `errors.py` 新增 3 个错误类且命名和格式一致 | 代码审查 |
| 16 | 全部 12 个测试用例通过 `pytest` | `pytest backend/app/modules/workspace/tests/test_relation_router.py -v` |
| 17 | 现有 workspace 测试仍全部通过（无回归） | `pytest backend/app/modules/workspace/tests/ -v` |
