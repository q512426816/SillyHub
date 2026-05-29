---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-02
title: WorkspaceRelation 模块 — CRUD + 拓扑查询
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-04, task-05]
allowed_paths:
  - backend/app/modules/workspace/model.py
  - backend/app/modules/workspace/relation_schema.py
  - backend/app/modules/workspace/relation_service.py
  - backend/app/modules/workspace/router.py
  - backend/app/modules/workspace/topology.py
  - backend/app/modules/workspace/tests/test_relation_router.py
  - backend/app/core/errors.py
---

# task-02: WorkspaceRelation 模块 — CRUD + 拓扑查询

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/model.py` | 已有 | `WorkspaceRelation` 表定义已存在于 model.py 中（与 Workspace 同文件） |
| `backend/app/modules/workspace/relation_schema.py` | 已有 | Pydantic DTO 已创建（RelationCreate / RelationRead / RelationListResponse / TopologyNode / TopologyEdge / TopologyResponse） |
| `backend/app/modules/workspace/relation_service.py` | 已有 | RelationService 类已实现（list_for_workspace / create / delete） |
| `backend/app/modules/workspace/topology.py` | 已有 | TopologyBuilder.build() 已实现 |
| `backend/app/modules/workspace/router.py` | 已有 | 4 个端点已注册（list_relations / create_relation / delete_relation / get_topology） |
| `backend/app/modules/workspace/tests/test_relation_router.py` | 已有 | 12 个 HTTP 级测试已编写 |
| `backend/app/core/errors.py` | 已有 | RelationNotFound / RelationSelfLoop / RelationDuplicate 已添加 |

**当前状态：代码和测试已全部落地。本任务需要验证其正确性并确保通过全部测试。**

## 实现要求

1. **WorkspaceRelation 模型**（`model.py`）：有向边表，`source_id` 和 `target_id` 均为 UUID FK 到 `workspaces.id`（CASCADE 删除），`relation_type` 为 String(50)，UQ 约束 `(source_id, target_id, relation_type)`，禁止自环（应用层校验），允许循环依赖。

2. **Pydantic DTO**（`relation_schema.py`）：`RelationCreate`（target_id + relation_type Literal + description 可选）、`RelationRead`（全部字段，from_attributes=True）、`RelationListResponse`（outgoing + incoming 两个列表）、`TopologyNode`（id/name/slug/component_key）、`TopologyEdge`（id/source_id/target_id/relation_type/description）、`TopologyResponse`（nodes + edges）。

3. **RelationService**（`relation_service.py`）：三个方法：
   - `list_for_workspace(workspace_id)` — 校验 workspace 存在后查询出边 + 入边
   - `create(source_id, payload)` — 自环检查 → source 存在性 → target 存在性 → 三元组重复检查 → insert → IntegrityError 兜底
   - `delete(relation_id)` — 加载 → 不存在抛 RelationNotFound → 删除前拷贝数据 → delete → commit → 返回拷贝

4. **TopologyBuilder**（`topology.py`）：静态方法 `build(session)` 查询所有 active workspace（deleted_at IS NULL）+ 所有 relation，过滤只返回两端都 active 的边。

5. **Router 端点**（`router.py`）：
   - `GET /api/workspaces/topology` — 权限 WORKSPACE_READ，必须在 `/{workspace_id}` 路由之前定义
   - `GET /api/workspaces/{workspace_id}/relations` — 权限 WORKSPACE_READ
   - `POST /api/workspaces/{workspace_id}/relations` — 权限 WORKSPACE_WRITE，201
   - `DELETE /api/workspaces/relations/{relation_id}` — 权限 WORKSPACE_ADMIN，200

6. **错误类**（`errors.py`）：`RelationNotFound`(404) / `RelationSelfLoop`(400) / `RelationDuplicate`(409)，继承 AppError。

## 接口定义（代码类任务必填）

### API 端点签名

```
GET    /api/workspaces/topology
       -> TopologyResponse
       权限: WORKSPACE_READ

GET    /api/workspaces/{workspace_id}/relations
       -> RelationListResponse
       权限: WORKSPACE_READ

POST   /api/workspaces/{workspace_id}/relations
       body: RelationCreate { target_id: UUID, relation_type: Literal[...], description?: str }
       -> RelationRead (201)
       权限: WORKSPACE_WRITE

DELETE /api/workspaces/relations/{relation_id}
       -> RelationRead (200)
       权限: WORKSPACE_ADMIN
```

### 数据结构

```python
# RelationCreate（请求体）
{
  "target_id": "uuid-string",
  "relation_type": "depends_on" | "consumes_api_from" | "tests" | "publishes_to" | "documents",
  "description": "optional string"  // nullable
}

# RelationRead（响应）
{
  "id": "uuid-string",
  "source_id": "uuid-string",
  "target_id": "uuid-string",
  "relation_type": "depends_on",
  "description": "optional string or null",
  "created_at": "ISO-8601"
}

# RelationListResponse
{
  "outgoing": [RelationRead, ...],
  "incoming": [RelationRead, ...]
}

# TopologyResponse
{
  "nodes": [{"id": "uuid", "name": "...", "slug": "...", "component_key": "..."}],
  "edges": [{"id": "uuid", "source_id": "uuid", "target_id": "uuid", "relation_type": "...", "description": "..."}]
}
```

### RelationService 方法签名

```python
class RelationService:
    def __init__(self, session: AsyncSession) -> None: ...

    async def list_for_workspace(self, workspace_id: uuid.UUID) -> RelationListResponse:
        # 1. ws_service.get(workspace_id) — 校验存在性，不存在抛 WorkspaceNotFound
        # 2. SELECT WHERE source_id = workspace_id -> outgoing
        # 3. SELECT WHERE target_id = workspace_id -> incoming
        # 4. return RelationListResponse(outgoing=..., incoming=...)

    async def create(self, source_id: uuid.UUID, payload: RelationCreate) -> WorkspaceRelation:
        # 1. if source_id == payload.target_id: raise RelationSelfLoop
        # 2. ws_service.get(source_id) — 校验 source 存在
        # 3. session.get(Workspace, target_id) — 校验 target 存在且未软删除
        # 4. SELECT WHERE (source, target, type) 匹配 — 存在则 raise RelationDuplicate
        # 5. session.add(relation) -> flush -> catch IntegrityError 转 RelationDuplicate -> commit -> refresh

    async def delete(self, relation_id: uuid.UUID) -> WorkspaceRelation:
        # 1. session.get(WorkspaceRelation, relation_id) — None 则 raise RelationNotFound
        # 2. 拷贝 relation 数据到新对象（因为 delete 后原对象不可用）
        # 3. session.delete(relation) -> commit
        # 4. return 拷贝对象
```

### TopologyBuilder 方法签名

```python
class TopologyBuilder:
    @staticmethod
    async def build(session: AsyncSession) -> TopologyResponse:
        # 1. SELECT Workspace WHERE deleted_at IS NULL -> nodes
        # 2. 收集 active_ids = {ws.id for ws in workspaces}
        # 3. SELECT WorkspaceRelation -> all_relations
        # 4. edges = [r for r in all_relations if r.source_id in active_ids and r.target_id in active_ids]
        # 5. return TopologyResponse(nodes=..., edges=...)
```

### 错误响应格式

```python
# AppError 基类返回格式
{
  "code": "HTTP_400_RELATION_SELF_LOOP",    # 或其他错误码
  "message": "Cannot create a self-referencing relation.",
  "request_id": "uuid",
  "details": {"workspace_id": "..."} | null
}

# 错误码表
RelationNotFound  -> code="HTTP_404_RELATION_NOT_FOUND",  status=404
RelationSelfLoop  -> code="HTTP_400_RELATION_SELF_LOOP",  status=400
RelationDuplicate -> code="HTTP_409_RELATION_DUPLICATE",  status=409
WorkspaceNotFound -> code="HTTP_404_WORKSPACE_NOT_FOUND", status=404 (复用已有)
```

## 边界处理（必填）

1. **自环禁止**：`source_id == target_id` 时 service 层第一行就检查并抛出 `RelationSelfLoop(400)`，错误消息为 `"Cannot create a self-referencing relation."`。DB CHECK constraint 由 task-01 迁移负责，代码层是第一道防线。

2. **Workspace 已软删除**：source workspace 通过 `WorkspaceService.get()` 校验（内部检查 `deleted_at is not None` 则抛 WorkspaceNotFound）。target workspace 通过 `session.get(Workspace, target_id)` 获取后检查 `deleted_at is not None` 则手动抛 WorkspaceNotFound。两边都拦截。

3. **重复三元组**：(source_id, target_id, relation_type) 三元组唯一。service 层先 SELECT 查询，存在则抛 `RelationDuplicate(409)`。此外 `flush()` 时 catch IntegrityError 检查 `ux_workspace_relations_triplet` 消息，兜底转换为 RelationDuplicate。两层防护。

4. **循环依赖合法**：A->B 和 B->A 可以共存（不同 relation_type 或相同 relation_type）。不做 DAG 校验，不检测环。同对节点不同 relation_type 可以有多条边。

5. **删除 Workspace 后关系清理**：FK 设置了 `ON DELETE CASCADE`。Workspace 硬删除时 relation 自动清理。软删除场景下 relation 保留在 DB 中，但 `TopologyBuilder.build()` 只返回 active workspace 的节点和边，软删除 workspace 的边被过滤掉。

6. **删除已删除的 relation**：`session.get(WorkspaceRelation, relation_id)` 返回 None，直接抛 `RelationNotFound(404)`。不区分"不存在"和"已删除"（relation 没有软删除机制，只有硬删除）。

7. **Topology 只含 active workspace**：`TopologyBuilder.build()` 查询 `deleted_at IS NULL` 的 workspace 作为节点，边通过 `if rel.source_id in active_ids and rel.target_id in active_ids` 过滤。确保已删除 workspace 及其关联边不出现。

8. **路由注册顺序**：`GET /workspaces/topology` 必须定义在 `GET /workspaces/{workspace_id}` 和 `GET /workspaces/{workspace_id}/relations` 之前。当前代码中 topology 端点已正确放置在 `{workspace_id}` 路由之前（在 create_workspace 之后、list_workspaces 之前）。

9. **无 auth 返回 401**：所有端点都有 `Depends(require_permission_any(...))` 保护，无 Authorization header 时返回 401。

## 非目标（本任务不做的事）

- 不做分页（初期 workspace 数量少，后续按需加 limit/offset）
- 不做关系更新（relation 没有可变字段，需要改就删了重建）
- 不做批量创建/删除（单条操作足够，批量留给 scanner reparse）
- 不做权限粒度到 relation 级别（复用 WORKSPACE_READ/WRITE/ADMIN）
- 不做拓扑图的子图查询（只提供全局图，后续可加 `?workspace_id=` 过滤）
- 不做图算法（最短路径、连通分量等），只做基础 CRUD + 全图返回
- 不做 Alembic 迁移脚本（由 task-01 负责）
- 不做 `WorkspaceRelation` 独立模型文件（保持在 `model.py` 中与 Workspace 同文件）

## 参考

| 项目 | 路径 | 说明 |
|---|---|---|
| 设计文档 ADR-03 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` | WorkspaceRelation 是自由有向图 |
| 实现计划 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` | Wave 2，task-02 |
| Workspace 模型 | `backend/app/modules/workspace/model.py` | WorkspaceRelation 定义在同文件 L119-158 |
| Workspace 服务模式 | `backend/app/modules/workspace/service.py` | IntegrityError 处理模式参考 |
| Workspace router 模式 | `backend/app/modules/workspace/router.py` | 端点注册 + 权限注解模式 |
| 错误类模式 | `backend/app/core/errors.py` | AppError 子类命名规范 |
| 权限枚举 | `backend/app/modules/auth/permissions.py` | WORKSPACE_READ/WRITE/ADMIN |
| 测试 fixture | `backend/conftest.py` | client + auth_headers + db_engine + db_session |
| 已有 relation 测试 | `backend/app/modules/workspace/tests/test_relation_router.py` | 12 个测试用例 |
| 已有 workspace 测试 | `backend/app/modules/workspace/tests/test_router.py` | 回归测试参考 |

## TDD 步骤

### Red 阶段（测试已编写 — 12 个用例）

测试文件：`backend/app/modules/workspace/tests/test_relation_router.py`

| # | 测试名 | 场景 |
|---|---|---|
| 1 | `test_create_relation_success` | 创建 A->B 依赖关系，验证 201 + 字段正确 |
| 2 | `test_create_duplicate_relation_returns_409` | 同一三元组重复创建，验证 409 |
| 3 | `test_create_self_loop_returns_400` | source==target，验证 400 |
| 4 | `test_create_relation_target_not_found` | target 不存在，验证 404 |
| 5 | `test_create_relation_source_not_found` | source 不存在，验证 404 |
| 6 | `test_list_relations_outgoing_and_incoming` | A->B, C->A，验证 A 的 outgoing/incoming |
| 7 | `test_delete_relation_success` | 创建后删除，验证从列表消失 |
| 8 | `test_delete_nonexistent_relation_returns_404` | 删除不存在的 relation，验证 404 |
| 9 | `test_topology_returns_global_graph` | 3 节点 2 边，验证图结构完整 |
| 10 | `test_topology_excludes_deleted_workspaces` | 软删除 B 后，验证 nodes 和 edges 不含 B |
| 11 | `test_list_relations_empty` | 无关系的 workspace 查询返回空列表 |
| 12 | `test_same_pair_different_types_coexist` | A->B (depends_on) + A->B (consumes_api_from) 共存 |

### Green 阶段（实现已完成）

实现文件全部就绪：
1. `errors.py` — 3 个错误类
2. `model.py` — WorkspaceRelation 模型（L119-158）
3. `relation_schema.py` — 全部 DTO
4. `relation_service.py` — RelationService（list_for_workspace / create / delete）
5. `topology.py` — TopologyBuilder.build()
6. `router.py` — 4 个端点（注意 topology 在 `{workspace_id}` 路由之前）

### Refactor 阶段

- 确认 query 使用了正确的索引列（ux_workspace_relations_triplet, ix_workspace_relations_source, ix_workspace_relations_target）
- 确认日志格式与现有 workspace 模块一致（`log.info("relation.created", ...)` / `log.info("relation.deleted", ...)`）
- 确认 IntegrityError 消息匹配逻辑与 WorkspaceService._translate_integrity_error 模式一致

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `model.py` 中 `WorkspaceRelation` 类的字段定义 | 包含 id/source_id/target_id/relation_type/description/created_at，UQ triplet index 存在，source/target index 存在 |
| AC-02 | 检查 `relation_schema.py` 包含的 DTO 类型 | RelationCreate/RelationRead/RelationListResponse/TopologyNode/TopologyEdge/TopologyResponse 全部存在 |
| AC-03 | 运行 `test_create_relation_success` | 201，response.source_id == A.id，response.target_id == B.id，relation_type == "depends_on" |
| AC-04 | 运行 `test_create_self_loop_returns_400` | 400，response.code == "HTTP_400_RELATION_SELF_LOOP" |
| AC-05 | 运行 `test_create_duplicate_relation_returns_409` | 第二次 409，response.code == "HTTP_409_RELATION_DUPLICATE" |
| AC-06 | 运行 `test_create_relation_target_not_found` + `test_create_relation_source_not_found` | 均返回 404，code == "HTTP_404_WORKSPACE_NOT_FOUND" |
| AC-07 | 运行 `test_list_relations_outgoing_and_incoming` | outgoing 长度 1 且 target_id == B.id，incoming 长度 1 且 source_id == C.id |
| AC-08 | 运行 `test_delete_relation_success` | DELETE 200，后续 GET outgoing 为空 |
| AC-09 | 运行 `test_delete_nonexistent_relation_returns_404` | 404，code == "HTTP_404_RELATION_NOT_FOUND" |
| AC-10 | 运行 `test_topology_returns_global_graph` | nodes >= 3，edges >= 2，包含 (A->B, depends_on) 和 (B->C, tests) |
| AC-11 | 运行 `test_topology_excludes_deleted_workspaces` | nodes 不含 B.id，edges 不含涉及 B 的边 |
| AC-12 | 运行 `test_list_relations_empty` | outgoing == []，incoming == [] |
| AC-13 | 运行 `test_same_pair_different_types_coexist` | 第二次 201，GET outgoing 长度 == 2 |
| AC-14 | 所有端点无 auth headers 访问 | 返回 401 |
| AC-15 | 检查 `errors.py` | RelationNotFound/RelationSelfLoop/RelationDuplicate 存在，继承 AppError，code/http_status 正确 |
| AC-16 | `pytest backend/app/modules/workspace/tests/test_relation_router.py -v` | 12 个测试全部 PASSED |
| AC-17 | `pytest backend/app/modules/workspace/tests/ -v` | 所有 workspace 测试通过（含 test_router.py 等已有测试），无回归 |
