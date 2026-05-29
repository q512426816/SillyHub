---
id: task-08
title: 测试覆盖 — 全量 pytest
priority: P0
estimated_hours: 3
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
allowed_paths:
  - backend/app/modules/workspace/tests/
  - backend/app/modules/change/tests/
  - backend/app/modules/task/tests/
  - backend/app/modules/agent/tests/
author: qinyi
created_at: 2026-05-28 16:25:00
---

# task-08: 测试覆盖 — 全量 pytest

本任务是 Wave 4 验收任务，在 task-01 ~ task-07 全部完成后执行。目标是为 component-as-workspace 变更的所有新增和修改逻辑编写完整的 pytest 测试，确保 WorkspaceRelation CRUD、M:N 关联、拓扑 API、Scanner 解析迁移、Agent 跨空间上下文构建等功能正确工作，并保证全量回归通过。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/tests/test_relation_service.py` | 新增 | WorkspaceRelation CRUD 服务层测试 |
| `backend/app/modules/workspace/tests/test_relation_router.py` | 新增 | WorkspaceRelation + 拓扑 API HTTP 测试 |
| `backend/app/modules/workspace/tests/test_scanner.py` | 修改 | 补充 YAML 解析创建 Workspace + WorkspaceRelation 的测试用例 |
| `backend/app/modules/change/tests/test_m2n.py` | 新增 | Change M:N workspace 关联测试 |
| `backend/app/modules/task/tests/test_m2n.py` | 新增 | Task M:N workspace 关联测试 |
| `backend/app/modules/agent/tests/test_context_builder.py` | 修改 | 补充 Agent 跨空间上下文构建（基于 WorkspaceRelation）的测试 |
| `backend/app/modules/agent/tests/test_m2n.py` | 新增 | AgentRun M:N workspace 关联测试 |

## 实现要求

### 1. WorkspaceRelation CRUD（test_relation_service.py + test_relation_router.py）

**服务层测试（test_relation_service.py）：**
- 创建关系：给定两个 workspace ID 和 relation_type，创建 WorkspaceRelation 记录
- 查询出边：查询某个 workspace 的所有出边关系（source_id = 该 workspace）
- 查询入边：查询某个 workspace 的所有入边关系（target_id = 该 workspace）
- 查询双向：查询某个 workspace 的所有关系（出边 + 入边）
- 删除关系：按 relation_id 删除，验证记录消失
- 按 relation_type 过滤：只返回特定类型的关系
- 支持所有 5 种 relation_type：depends_on, consumes_api_from, tests, publishes_to, documents

**HTTP 层测试（test_relation_router.py）：**
- `POST /api/workspaces/{id}/relations` — 创建关系，返回 201 + 完整 relation 对象
- `GET /api/workspaces/{id}/relations` — 查询关系列表，返回 200 + items + total
- `DELETE /api/workspaces/relations/{relation_id}` — 删除关系，返回 200
- `GET /api/workspaces/topology` — 全局拓扑图，返回 200 + nodes + edges
- 无认证访问返回 401
- 不存在的 workspace 返回 404
- 不存在的 relation_id 删除返回 404

### 2. 循环依赖与自环（test_relation_service.py）

- A → B → A：创建两条关系 A depends_on B + B depends_on A，验证双向查询都能返回
- 多节点循环：A → B → C → A，验证三节点循环正确存储和查询
- 循环依赖不影响拓扑 API 输出
- 循环依赖不影响 context_builder（depth 限制生效）

### 3. 全局拓扑 API（test_relation_router.py）

- 空图：无 workspace 无 relation 时返回空 nodes 和 edges
- 只有 workspace 无 relation：返回 nodes 列表，edges 为空
- 有 workspace 有 relation：返回完整图结构
- 每条 edge 包含 source_id, target_id, relation_type, description
- 每个 node 包含 id, name, slug, component_key, type
- 多种 relation_type 的边共存

### 4. Change/Task M:N 关联（test_m2n.py）

**Change M:N（change/tests/test_m2n.py）：**
- 创建 Change 时指定 workspace_ids: [ws1, ws2]，验证 change_workspaces 表有 2 条记录
- 查询某个 workspace 关联的所有 changes：GET /api/workspaces/{id}/changes
- 一个 change 关联多个 workspace：验证查询结果正确
- 多个 change 关联同一个 workspace：验证查询结果包含所有关联 change
- role 字段区分：primary / affected / referenced
- 解除关联：删除 change_workspaces 记录后，查询不再返回该 change
- workspace_ids 为空列表时，保留原有 workspace_id FK 作为主 workspace

**Task M:N（task/tests/test_m2n.py）：**
- 同 Change 模式：创建 Task 时指定 workspace_ids
- 查询某个 workspace 关联的所有 tasks
- 一个 task 关联多个 workspace
- 多个 task 关联同一个 workspace
- role 字段区分
- 解除关联后查询正确

### 5. AgentRun M:N 关联（agent/tests/test_m2n.py）

- 创建 AgentRun 时关联多个 workspace_id
- 查询某个 workspace 关联的所有 agent_runs
- 一个 agent_run 关联多个 workspace
- agent_run_workspaces 表记录正确创建和查询
- AgentRun 删除后（CASCADE），关联记录自动清理

### 6. Scanner 解析迁移（workspace/tests/test_scanner.py 补充）

- YAML 中定义多个 component，解析后每个 component 创建独立的 Workspace 记录
- YAML 中定义 component 间的 depends_on 关系，解析后创建对应的 WorkspaceRelation 记录
- 验证 Workspace 记录的 component_key, tech_stack, build_command, test_command, role, repo_url, default_branch, source_yaml_path 字段正确填充
- 验证 WorkspaceRelation 的 relation_type 正确映射
- 重复扫描幂等：第二次扫描不创建重复 Workspace 和 WorkspaceRelation
- YAML 中无 component 定义时，只创建 workspace 本身，无 relation

### 7. Agent context_builder 跨空间（agent/tests/test_context_builder.py 补充）

- 创建 workspace A（含 spec）+ workspace B（含 spec）+ WorkspaceRelation(A, B, depends_on)
- 调用 build_spec_bundle 时传入 task 关联到 workspace A
- 验证 bundle.referenced_workspaces 包含 workspace B 的摘要
- 验证摘要包含 workspace B 的 name, component_key, spec_root
- depth=1（默认）：只拉取直接关联的 workspace
- depth=2：拉取二跳关联的 workspace（A → B → C）
- 无关联 workspace 时 referenced_workspaces 为空列表
- 循环依赖 + depth 限制：不会无限递归

### 8. 全量 pytest 回归

- `pytest backend/` 全部通过
- 无新增 warning 或 deprecation
- 无 dangling import（component 模块已完全删除）

## 接口定义

### 测试 Fixture 接口

```python
# workspace/tests/test_relation_service.py
@pytest.fixture()
async def two_workspaces(db_session, tmp_path) -> dict:
    """创建两个 workspace 并返回 {ws_a_id, ws_b_id}。"""
    ...

@pytest.fixture()
async def three_workspaces(db_session, tmp_path) -> dict:
    """创建三个 workspace 并返回 {ws_a_id, ws_b_id, ws_c_id}。"""
    ...

# workspace/tests/test_relation_router.py
@pytest.fixture()
async def workspace_with_relations(client, tmp_path, auth_headers) -> dict:
    """创建 workspace 并建立关系，返回 {ws_id, relation_ids}。"""
    ...

# change/tests/test_m2n.py
@pytest.fixture()
async def change_with_multi_workspaces(client, tmp_path, auth_headers) -> dict:
    """创建关联多个 workspace 的 change，返回 {change_id, ws_ids}。"""
    ...

# task/tests/test_m2n.py
@pytest.fixture()
async def task_with_multi_workspaces(client, tmp_path, auth_headers) -> dict:
    """创建关联多个 workspace 的 task，返回 {task_id, ws_ids}。"""
    ...
```

### 被测服务接口

```python
# workspace/relation_service.py
class WorkspaceRelationService:
    async def create(self, source_id: UUID, target_id: UUID, relation_type: str, description: str | None = None) -> WorkspaceRelation
    async def get_by_workspace(self, workspace_id: UUID, direction: str = "both", relation_type: str | None = None) -> list[WorkspaceRelation]
    async def delete(self, relation_id: UUID) -> None
    async def get_topology() -> TopologyGraph

# workspace/topology.py
class TopologyGraph:
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]

class TopologyNode:
    id: UUID
    name: str
    slug: str
    component_key: str | None
    type: str | None

class TopologyEdge:
    source_id: UUID
    target_id: UUID
    relation_type: str
    description: str | None

# agent/context_builder.py（修改后）
async def build_spec_bundle(session, change_id: UUID, task_id: UUID, workspace_id: UUID, depth: int = 1) -> AgentSpecBundle
# AgentSpecBundle 新增字段：
#   referenced_workspaces: list[WorkspaceSpecSummary]

class WorkspaceSpecSummary:
    workspace_id: UUID
    name: str
    component_key: str | None
    spec_root: str
    relation_type: str | None
    direction: str  # "outgoing" | "incoming"
```

## 边界处理

1. **自环拒绝**：创建 relation 时 source_id == target_id 应抛出 `WorkspaceRelationSelfLoop` 错误（HTTP 422），不允许 workspace 引用自身
2. **UQ 冲突**：同一对 (source_id, target_id, relation_type) 创建第二条记录应抛出 `WorkspaceRelationDuplicate` 错误（HTTP 409），但允许同一对节点不同 relation_type
3. **不存在的 workspace**：创建 relation 时 source_id 或 target_id 指向不存在的 workspace，应抛出 `WorkspaceNotFound`（HTTP 404）
4. **CASCADE 删除**：删除 workspace 后，所有 source_id 或 target_id 指向该 workspace 的 WorkspaceRelation 自动级联删除，change_workspaces / task_workspaces / agent_run_workspaces 中对应的记录也级联删除
5. **workspace_ids 空列表**：创建 Change/Task 时 workspace_ids 为空列表不报错，使用原有 workspace_id FK 作为主 workspace；workspace_ids 与 workspace_id 可以有交集，不创建重复关联记录
6. **拓扑 API 大规模性能**：拓扑 API 在 50+ workspace、100+ relation 场景下响应时间 < 500ms（只做基本验证，不做极限压测）
7. **context_builder depth 限制**：depth=0 时 referenced_workspaces 为空；depth 超过实际图深度时不会报错，返回所有可达 workspace；循环依赖图 + depth=2 不会无限递归
8. **Scanner YAML 格式兼容**：YAML 中 component 无 relations 字段时不报错，只创建 workspace 不创建 relation；YAML 中引用不存在的 component_key 作为依赖目标时发出 warning 但不报错

## 非目标

- 不做前端 UI 测试
- 不做性能极限压测（仅做基本的 50 workspace 验证）
- 不做并发竞态条件测试
- 不做数据库迁移回滚测试（Alembic 迁移在 task-01 中已验证）
- 不做 Redis 依赖的集成测试（SSE streaming 在其他变更中覆盖）
- 不做真实 Agent 执行的端到端测试（只测 context_builder 逻辑）
- 不重写已有的通过测试（workspace CRUD、change reparse、task reparse 等已有用例保留不动）

## 参考

- **设计文档**：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md`
  - ADR-07: Workspace 是唯一基本单元
  - ADR-08: WorkspaceRelation 有向图
  - ADR-09: Change/Task/AgentRun M:N 关联
  - ADR-10: 跨空间引用基于 WorkspaceRelation
- **计划文档**：`.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` — Wave 4 验收
- **现有测试模式**：
  - `backend/app/modules/workspace/tests/test_router.py` — HTTP 测试模式（AsyncClient + auth_headers）
  - `backend/app/modules/workspace/tests/test_service.py` — 服务层测试模式（db_session fixture）
  - `backend/conftest.py` — 全局 fixture（db_engine, db_session, client, auth_headers）
- **数据模型**：design.md 中的 workspace_relations / change_workspaces / task_workspaces / agent_run_workspaces 表定义
- **API 设计**：design.md 中的 WorkspaceRelation + Change/Task 端点定义

## TDD 步骤

### Phase 1：WorkspaceRelation CRUD 测试（~45min）

1. **RED**：编写 `test_relation_service.py` 中的测试用例
   - `test_create_relation_success` — 创建关系成功
   - `test_create_self_loop_raises` — 自环拒绝
   - `test_create_duplicate_raises` — UQ 冲突
   - `test_create_with_nonexistent_workspace_raises` — 不存在的 workspace
   - `test_get_outgoing_relations` — 查询出边
   - `test_get_incoming_relations` — 查询入边
   - `test_get_both_directions` — 双向查询
   - `test_delete_relation_success` — 删除成功
   - `test_delete_nonexistent_raises` — 删除不存在的 relation

2. **GREEN**：运行测试确认通过（task-02 的实现代码已完成）

3. **RED**：编写 `test_relation_router.py` 中的 HTTP 测试
   - `test_create_relation_endpoint` — POST /api/workspaces/{id}/relations
   - `test_list_relations_endpoint` — GET /api/workspaces/{id}/relations
   - `test_delete_relation_endpoint` — DELETE /api/workspaces/relations/{id}
   - `test_topology_empty` — GET /api/workspaces/topology 空图
   - `test_topology_with_relations` — 有数据的拓扑图
   - `test_no_auth_returns_401` — 无认证
   - `test_not_found_returns_404` — 不存在的 workspace/relation

4. **GREEN**：运行测试确认通过

### Phase 2：循环依赖测试（~20min）

5. **RED**：在 `test_relation_service.py` 中添加循环依赖测试
   - `test_cycle_two_nodes` — A → B → A 双向循环
   - `test_cycle_three_nodes` — A → B → C → A 三节点循环
   - `test_cycle_visible_in_topology` — 循环依赖在拓扑中正确呈现
   - `test_cycle_visible_in_context_builder` — 循环依赖在 context_builder 中受 depth 控制

6. **GREEN**：运行测试确认通过

### Phase 3：M:N 关联测试（~40min）

7. **RED**：编写 `change/tests/test_m2n.py`
   - `test_create_change_with_multiple_workspaces` — 多 workspace 关联
   - `test_query_changes_by_workspace` — 按 workspace 查询 change
   - `test_multiple_changes_one_workspace` — 多 change 共享 workspace
   - `test_change_workspace_role` — role 字段区分
   - `test_dissociate_change_from_workspace` — 解除关联

8. **GREEN**：运行测试确认通过

9. **RED**：编写 `task/tests/test_m2n.py`（同 change 模式）
   - `test_create_task_with_multiple_workspaces`
   - `test_query_tasks_by_workspace`
   - `test_multiple_tasks_one_workspace`
   - `test_task_workspace_role`
   - `test_dissociate_task_from_workspace`

10. **GREEN**：运行测试确认通过

11. **RED**：编写 `agent/tests/test_m2n.py`
    - `test_create_agent_run_with_multiple_workspaces`
    - `test_query_agent_runs_by_workspace`
    - `test_cascade_delete_agent_run_workspaces`

12. **GREEN**：运行测试确认通过

### Phase 4：Scanner 迁移测试（~20min）

13. **RED**：在 `test_scanner.py` 中补充测试
    - `test_parse_yaml_creates_independent_workspaces` — YAML 解析创建独立 workspace
    - `test_parse_yaml_creates_workspace_relations` — YAML 解析创建关系
    - `test_parse_yaml_fills_component_metadata` — 元数据字段正确填充
    - `test_parse_yaml_idempotent` — 重复扫描幂等
    - `test_parse_yaml_no_components` — 无 component 定义时无 relation

14. **GREEN**：运行测试确认通过

### Phase 5：Agent context_builder 测试（~25min）

15. **RED**：在 `test_context_builder.py` 中补充测试
    - `test_build_spec_bundle_with_referenced_workspaces` — referenced_workspaces 包含关联 workspace 摘要
    - `test_referenced_workspace_summary_fields` — 摘要字段完整
    - `test_depth_1_only_direct_relations` — depth=1 只拉直接关联
    - `test_depth_2_pulls_two_hops` — depth=2 拉取二跳
    - `test_no_relations_empty_referenced` — 无关联时为空
    - `test_cycle_depth_limited_no_infinite_recursion` — 循环 + depth 不无限递归

16. **GREEN**：运行测试确认通过

### Phase 6：全量回归（~10min）

17. 运行 `pytest backend/ --tb=short -q`
18. 确认所有测试通过，无 warning
19. 确认无 component 模块的 dangling import

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | WorkspaceRelation CRUD 测试 | 创建/查询/删除测试全部通过，覆盖 5 种 relation_type |
| AC-02 | 自环拒绝测试 | source_id == target_id 时返回 422，错误码 `HTTP_422_WORKSPACE_RELATION_SELF_LOOP` |
| AC-03 | UQ 冲突测试 | 同 (source_id, target_id, relation_type) 重复创建返回 409 |
| AC-04 | 循环依赖测试 | A→B→A 和 A→B→C→A 正确存储、查询和展示 |
| AC-05 | 全局拓扑 API 测试 | GET /api/workspaces/topology 返回正确的 nodes + edges 结构 |
| AC-06 | 拓扑空图测试 | 无数据时返回 `{"nodes": [], "edges": []}` |
| AC-07 | Change M:N 关联测试 | 多 workspace 关联创建、查询、解除均正确 |
| AC-08 | Task M:N 关联测试 | 多 workspace 关联创建、查询、解除均正确 |
| AC-09 | AgentRun M:N 关联测试 | 多 workspace 关联创建、查询、CASCADE 删除均正确 |
| AC-10 | Scanner 迁移测试 | YAML 解析创建独立 Workspace + WorkspaceRelation，元数据字段正确 |
| AC-11 | Scanner 幂等测试 | 重复扫描不创建重复记录 |
| AC-12 | Agent context_builder 测试 | referenced_workspaces 包含关联 workspace 摘要，字段完整 |
| AC-13 | context_builder depth 测试 | depth=1 只拉直接关联，depth=2 拉二跳，depth=0 返回空 |
| AC-14 | context_builder 循环安全 | 循环依赖 + depth 限制不触发无限递归 |
| AC-15 | CASCADE 删除测试 | 删除 workspace 后关联 relation 和 M:N 记录自动清理 |
| AC-16 | workspace_ids 空列表 | 创建 Change/Task 时 workspace_ids 为空不报错 |
| AC-17 | 全量 pytest | `pytest backend/` 全部通过，0 failed，0 error |
| AC-18 | 无 dangling import | component 模块相关 import 全部清理，conftest.py 无 component 引用 |
