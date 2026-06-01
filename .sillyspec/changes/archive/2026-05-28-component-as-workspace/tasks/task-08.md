---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-08
title: "测试覆盖 — 全量 pytest"
priority: P0
estimated_hours: 3
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07]
blocks: []
allowed_paths:
  - backend/app/modules/workspace/tests/test_relation_service.py
  - backend/app/modules/workspace/tests/test_relation_router.py
  - backend/app/modules/workspace/tests/test_scanner.py
  - backend/app/modules/workspace/tests/test_topology.py
  - backend/app/modules/workspace/tests/test_m2n_change.py
  - backend/app/modules/workspace/tests/test_m2n_task.py
  - backend/app/modules/agent/tests/test_context_builder.py
  - backend/app/modules/agent/tests/test_m2n_agent_run.py
  - backend/app/modules/change/tests/test_m2n.py
  - backend/app/modules/task/tests/test_m2n.py
  - backend/app/modules/scan_docs/tests/test_service.py
---

# task-08: 测试覆盖 — 全量 pytest

本任务是 Wave 4 验收任务，在 task-01 ~ task-07 全部完成后执行。目标是为 component-as-workspace 变更的所有新增和修改逻辑编写完整的 pytest 测试，确保 WorkspaceRelation CRUD、拓扑查询、M:N 关联、Scanner 解析迁移、Agent 跨空间上下文构建等功能正确工作，并保证全量回归通过。

## 修改文件（必填）

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/workspace/tests/test_relation_service.py` | **新增** | RelationService CRUD 服务层测试 |
| `backend/app/modules/workspace/tests/test_relation_router.py` | 已存在 | 补充循环依赖 + 无认证测试用例 |
| `backend/app/modules/workspace/tests/test_topology.py` | **新增** | TopologyBuilder 全局拓扑构建测试 |
| `backend/app/modules/workspace/tests/test_m2n_change.py` | **新增** | ChangeWorkspace M:N 关联测试 |
| `backend/app/modules/workspace/tests/test_m2n_task.py` | **新增** | TaskWorkspace M:N 关联测试 |
| `backend/app/modules/workspace/tests/test_scanner.py` | 已存在 | 补充 parser 集成测试用例 |
| `backend/app/modules/agent/tests/test_context_builder.py` | 已存在 | 补充 depth=2 多跳 + 循环递归安全测试 |
| `backend/app/modules/agent/tests/test_m2n_agent_run.py` | **新增** | AgentRunWorkspace M:N 关联 + enrich 测试 |
| `backend/app/modules/scan_docs/tests/test_service.py` | 已存在 | 补充 workspace 删除后 scan_doc 级联测试 |

## 实现要求

### 1. RelationService CRUD（test_relation_service.py — 新增）

使用 `db_session` fixture（来自 `conftest.py`）直接测试 `RelationService` 方法。

测试用例清单：

```python
# 每个测试先在 db_session 中创建 Workspace 记录（不通过 HTTP），再调用 RelationService 方法

async def test_create_relation_success(db_session):
    """创建 workspace A, B，调用 RelationService.create(A.id, payload)，
    验证返回 WorkspaceRelation 的 source_id, target_id, relation_type 正确"""

async def test_create_self_loop_raises(db_session):
    """创建 workspace A，调用 create(A.id, RelationCreate(target_id=A.id, ...))，
    断言 raises RelationSelfLoop"""

async def test_create_duplicate_raises(db_session):
    """创建 workspace A, B，两次 create(A, B, depends_on)，
    第二次断言 raises RelationDuplicate"""

async def test_create_with_nonexistent_source_raises(db_session):
    """调用 create(uuid_not_exist, payload)，断言 raises WorkspaceNotFound"""

async def test_create_with_nonexistent_target_raises(db_session):
    """创建 workspace A，调用 create(A.id, RelationCreate(target_id=uuid_not_exist, ...))，
    断言 raises WorkspaceNotFound"""

async def test_list_for_workspace_outgoing(db_session):
    """创建 A, B, C，创建 A→B, A→C，调用 list_for_workspace(A.id)，
    断言 outgoing 长度 2，incoming 长度 0"""

async def test_list_for_workspace_incoming(db_session):
    """创建 A, B, C，创建 B→A, C→A，调用 list_for_workspace(A.id)，
    断言 outgoing 长度 0，incoming 长度 2"""

async def test_list_for_workspace_both_directions(db_session):
    """创建 A, B, C，创建 A→B, C→A，调用 list_for_workspace(A.id)，
    断言 outgoing 1 条，incoming 1 条"""

async def test_list_for_workspace_empty(db_session):
    """创建 workspace A，调用 list_for_workspace(A.id)，
    断言 outgoing == [], incoming == []"""

async def test_delete_relation_success(db_session):
    """创建 A, B, relation A→B，调用 delete(relation.id)，
    再次 list_for_workspace(A.id) 验证为空"""

async def test_delete_nonexistent_raises(db_session):
    """调用 delete(uuid_not_exist)，断言 raises RelationNotFound"""

async def test_all_five_relation_types(db_session):
    """创建 A, B，依次创建 depends_on, consumes_api_from, tests, publishes_to, documents，
    验证 list_for_workspace 返回 5 条 outgoing"""
```

辅助函数模式：

```python
async def _create_workspace(session: AsyncSession, name: str, root_path: str) -> Workspace:
    """直接在 DB 创建 Workspace 记录（跳过 filesystem 验证）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws
```

### 2. RelationService 循环依赖（test_relation_service.py 续）

```python
async def test_cycle_two_nodes(db_session):
    """A→B (depends_on) + B→A (depends_on)，查询 A 验证 outgoing 包含 B、incoming 包含 B，
    查询 B 同理"""

async def test_cycle_three_nodes(db_session):
    """A→B, B→C, C→A，查询 A 验证 outgoing=[B], incoming=[C]"""

async def test_same_pair_different_types_coexist(db_session):
    """A→B (depends_on) + A→B (consumes_api_from) 均成功，
    list_for_workspace(A) 返回 2 条 outgoing"""
```

### 3. 全局拓扑（test_topology.py — 新增）

```python
async def test_topology_empty_graph(db_session):
    """无 workspace 无 relation，TopologyBuilder.build(session) 返回 nodes=[], edges=[]"""

async def test_topology_only_workspaces(db_session):
    """创建 3 个 workspace 无 relation，返回 nodes 长度 3, edges=[]"""

async def test_topology_with_relations(db_session):
    """创建 A, B, C，创建 A→B, B→C，验证 nodes 3 个, edges 2 条，
    edge 包含 id, source_id, target_id, relation_type, description"""

async def test_topology_excludes_soft_deleted(db_session):
    """创建 A, B, C，A→B，soft-delete B，验证 topology 不含 B 节点，
    且 A→B 的 edge 也被过滤掉"""

async def test_topology_node_fields(db_session):
    """创建 workspace 含 component_key，验证 TopologyNode 包含 id, name, slug, component_key"""

async def test_topology_multiple_relation_types(db_session):
    """A→B (depends_on) + A→B (consumes_api_from) + C→A (tests)，
    验证 edges 包含三种 relation_type"""
```

### 4. Relation Router 补充（test_relation_router.py — 补充）

现有测试文件已有 12 个用例（create/duplicate/self-loop/target-not-found/source-not-found/
list-outgoing+incoming/delete/delete-not-found/topology/topology-deleted/empty/different-types）。

需补充：

```python
async def test_no_auth_create_relation_returns_401(client, tmp_path):
    """POST /api/workspaces/{id}/relations 不带 Authorization，
    断言 401"""

async def test_no_auth_list_relations_returns_401(client, tmp_path):
    """GET /api/workspaces/{id}/relations 不带 Authorization，断言 401"""

async def test_no_auth_delete_relation_returns_401(client):
    """DELETE /api/workspaces/relations/{id} 不带 Authorization，断言 401"""

async def test_no_auth_topology_returns_401(client):
    """GET /api/workspaces/topology 不带 Authorization，断言 401"""

async def test_cycle_two_nodes_via_http(client, tmp_path, auth_headers):
    """创建 A, B，通过 HTTP 创建 A→B 和 B→A，
    GET /api/workspaces/topology 验证 edges 包含两条"""

async def test_cycle_three_nodes_via_http(client, tmp_path, auth_headers):
    """创建 A, B, C，通过 HTTP 创建 A→B, B→C, C→A，
    GET topology 验证 3 nodes, 3 edges"""
```

### 5. ChangeWorkspace M:N 关联（test_m2n_change.py — 新增）

测试 ChangeWorkspace 关联表的直接 DB 操作。

```python
async def test_create_change_workspace_link(db_session):
    """创建 workspace + change，直接 add ChangeWorkspace(change_id, workspace_id, role='primary')，
    flush 后查询验证记录存在"""

async def test_create_multiple_workspaces_for_change(db_session):
    """创建 ws1, ws2 + change，添加 ChangeWorkspace(change_id, ws1, 'primary') 和
    ChangeWorkspace(change_id, ws2, 'affected')，查询验证 2 条记录"""

async def test_multiple_changes_one_workspace(db_session):
    """创建 ws + change1 + change2，分别为两个 change 添加 ChangeWorkspace 指向 ws，
    查询 workspace_id=ws 的 ChangeWorkspace 记录，验证 2 条"""

async def test_role_field_values(db_session):
    """创建 change_workspace 记录，role 分别为 'primary', 'affected', 'referenced'，
    验证读取正确"""

async def test_cascade_delete_on_change(db_session):
    """创建 change + change_workspace，删除 change（session.delete + commit），
    查询 ChangeWorkspace 记录应为空（CASCADE 生效）"""

async def test_cascade_delete_on_workspace(db_session):
    """创建 workspace + change_workspace，删除 workspace，
    查询 ChangeWorkspace 记录应为空（CASCADE 生效）"""

async def test_duplicate_composite_pk_rejected(db_session):
    """同一 (change_id, workspace_id) 第二次插入应抛出 IntegrityError"""

async def test_composite_pk_allows_different_pairs(db_session):
    """同一 change_id 关联 ws1 和 ws2 均成功（不同 workspace_id）"""

async def test_read_schema_includes_workspace_ids(db_session):
    """创建 change + 关联 2 个 workspace，构造 ChangeRead，
    验证 workspace_ids 字段包含两个 workspace 的 id"""
```

### 6. TaskWorkspace M:N 关联（test_m2n_task.py — 新增）

与 ChangeWorkspace 模式相同。

```python
async def test_create_task_workspace_link(db_session):
    """创建 workspace + task + change，添加 TaskWorkspace，验证记录存在"""

async def test_create_multiple_workspaces_for_task(db_session):
    """task 关联多个 workspace，验证 2 条记录"""

async def test_multiple_tasks_one_workspace(db_session):
    """多个 task 关联同一个 workspace，验证查询正确"""

async def test_role_field_values(db_session):
    """primary / affected / referenced 角色值测试"""

async def test_cascade_delete_on_task(db_session):
    """删除 task 后 TaskWorkspace 记录级联删除"""

async def test_cascade_delete_on_workspace(db_session):
    """删除 workspace 后 TaskWorkspace 记录级联删除"""

async def test_duplicate_composite_pk_rejected(db_session):
    """同一 (task_id, workspace_id) 重复插入抛出 IntegrityError"""

async def test_read_schema_includes_workspace_ids(db_session):
    """TaskRead 的 workspace_ids 字段包含关联的 workspace id"""
```

### 7. AgentRunWorkspace M:N 关联（test_m2n_agent_run.py — 新增）

```python
async def test_create_agent_run_workspace_link(db_session):
    """创建 workspace + agent_run，添加 AgentRunWorkspace，验证记录存在"""

async def test_create_multiple_workspaces_for_agent_run(db_session):
    """agent_run 关联多个 workspace，验证记录数正确"""

async def test_cascade_delete_on_agent_run(db_session):
    """删除 agent_run 后 AgentRunWorkspace 级联删除"""

async def test_cascade_delete_on_workspace(db_session):
    """删除 workspace 后 AgentRunWorkspace 级联删除"""

async def test_duplicate_composite_pk_rejected(db_session):
    """同一 (agent_run_id, workspace_id) 重复插入抛出 IntegrityError"""

async def test_enrich_with_workspace_ids(db_session):
    """创建 agent_run + AgentRunWorkspace(ws1) + AgentRunWorkspace(ws2)，
    调用 AgentService.enrich_with_workspace_ids(run)，
    验证返回 AgentRunResponse.workspace_ids == [ws1.id, ws2.id]"""

async def test_enrich_empty_workspace_ids(db_session):
    """agent_run 无 AgentRunWorkspace 记录，
    enrich 返回 workspace_ids == []"""

async def test_list_runs_by_workspace(db_session):
    """创建 ws1, ws2 + run1(关联ws1) + run2(关联ws1,ws2)，
    调用 AgentService.list_runs(ws1) 返回 [run1, run2]，
    list_runs(ws2) 返回 [run2]"""
```

### 8. Scanner 解析迁移（test_scanner.py — 补充）

在现有 `test_scanner.py` 末尾添加 parser 集成测试。Scanner 解析后的 `ScanResult` 包含 `parsed_workspaces` 和 `parsed_relations`（在 `WorkspaceParser.parse()` 返回的 `ParseResult` 中）。测试需要验证 Scanner 与 Parser 的集成。

```python
def test_scan_result_has_parsed_workspaces_field():
    """ScanResult.parsed_workspaces 默认为空列表"""

def test_scan_result_has_parsed_relations_field():
    """ScanResult.parsed_relations 默认为空列表"""
```

注意：Scanner 的 `scan()` 方法是纯文件系统操作，返回 `ScanResult`。`ScanResult` 已有 `parsed_workspaces` 和 `parsed_relations` 字段但当前 scanner.scan() 不调用 parser。如果 task-04（解析器迁移）实现后 scanner 不自动调用 parser，这些测试只验证字段存在即可。

### 9. Agent context_builder 补充（test_context_builder.py — 补充）

现有测试文件已有完整的 `_fetch_referenced_workspaces` 测试（无关联、outgoing、incoming、跳过 deleted、跳过无 spec_workspace、读取 doc snippet、snippet 截断、循环依赖、无效 max_depth、同对多关系、零 snippet）。`build_spec_bundle` 测试也已完整。

需补充的测试：

```python
async def test_fetch_referenced_workspaces_depth_2(db_session):
    """创建 A, B, C，创建 A→B, B→C，
    调用 _fetch_referenced_workspaces(session, A.id, max_depth=2)，
    验证 result 包含 B 和 C 两个 workspace（二跳可达）"""

async def test_fetch_referenced_workspaces_depth_2_with_cycle(db_session):
    """创建 A, B, C，创建 A→B, B→C, C→A，
    调用 _fetch_referenced_workspaces(session, A.id, max_depth=2)，
    验证不触发无限递归，且返回 B 和 C（A 不在结果中因为已 visited）"""

async def test_fetch_referenced_workspaces_depth_1_excludes_second_hop(db_session):
    """创建 A, B, C，创建 A→B, B→C，
    调用 _fetch_referenced_workspaces(session, A.id, max_depth=1)，
    验证 result 只包含 B，不包含 C"""
```

### 10. 全量 pytest 回归

完成所有测试后：

1. 运行 `pytest backend/ --tb=short -q` 确认全部通过
2. 确认无新增 warning 或 deprecation
3. 确认无 component 模块的 dangling import（在 backend/app 中搜索 `component` import）

## 接口定义（代码类任务必填）

### 被测服务接口

```python
# workspace/relation_service.py — 已实现
class RelationService:
    def __init__(self, session: AsyncSession) -> None
    async def create(self, source_id: UUID, payload: RelationCreate) -> WorkspaceRelation
    async def list_for_workspace(self, workspace_id: UUID) -> RelationListResponse
    async def delete(self, relation_id: UUID) -> WorkspaceRelation

# RelationListResponse 字段
class RelationListResponse(BaseModel):
    outgoing: list[RelationRead]  # source = this workspace
    incoming: list[RelationRead]  # target = this workspace

# workspace/topology.py — 已实现
class TopologyBuilder:
    @staticmethod
    async def build(session: AsyncSession) -> TopologyResponse

class TopologyResponse(BaseModel):
    nodes: list[TopologyNode]
    edges: list[TopologyEdge]

class TopologyNode(BaseModel):
    id: UUID
    name: str
    slug: str
    component_key: str | None

class TopologyEdge(BaseModel):
    id: UUID
    source_id: UUID
    target_id: UUID
    relation_type: str
    description: str | None
```

### M:N 关联模型接口

```python
# workspace/model.py — 已实现
class ChangeWorkspace(BaseModel, table=True):
    change_id: UUID      # PK, FK changes.id CASCADE
    workspace_id: UUID   # PK, FK workspaces.id CASCADE
    role: str | None     # primary / affected / referenced

class TaskWorkspace(BaseModel, table=True):
    task_id: UUID        # PK, FK tasks.id CASCADE
    workspace_id: UUID   # PK, FK workspaces.id CASCADE
    role: str | None     # primary / affected / referenced

class AgentRunWorkspace(BaseModel, table=True):
    agent_run_id: UUID   # PK, FK agent_runs.id CASCADE
    workspace_id: UUID   # PK, FK workspaces.id CASCADE
```

### 错误类型接口

```python
# core/errors.py — 已实现
class RelationSelfLoop(AppError):
    code = "HTTP_400_RELATION_SELF_LOOP"
    http_status = 400

class RelationDuplicate(AppError):
    code = "HTTP_409_RELATION_DUPLICATE"
    http_status = 409

class RelationNotFound(AppError):
    code = "HTTP_404_RELATION_NOT_FOUND"
    http_status = 404

class WorkspaceNotFound(AppError):
    code = "HTTP_404_WORKSPACE_NOT_FOUND"
    http_status = 404
```

### 测试 Fixture 接口

```python
# 全局 conftest.py 已提供
@pytest.fixture()
async def db_engine() -> AsyncIterator[Any]  # 内存 SQLite + 全部表

@pytest.fixture()
async def db_session(db_engine) -> AsyncIterator[AsyncSession]  # DB session

@pytest.fixture()
async def client(db_engine) -> AsyncIterator[AsyncClient]  # HTTP test client

@pytest.fixture()
async def auth_headers(auth_admin_token) -> dict[str, str]  # Admin JWT header
```

### 测试辅助函数（在每个测试文件中定义）

```python
# test_relation_service.py, test_topology.py, test_m2n_*.py
async def _create_workspace(session, name, root_path) -> Workspace:
    """直接在 DB 创建 Workspace，不经过 HTTP 和 filesystem 验证。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower().replace(" ", "-"),
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws

# test_relation_router.py, test_topology.py (HTTP 层)
def _make_workspace(tmp_path: Path, name: str) -> Path:
    """创建含 .sillyspec 骨架的临时目录。"""
    base = tmp_path / name / ".sillyspec"
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    return tmp_path / name

async def _create_workspace_via_http(client, auth_headers, tmp_path, name) -> dict:
    """通过 HTTP POST 创建 workspace 并返回 JSON。"""
    ws_root = _make_workspace(tmp_path, name)
    resp = await client.post(
        "/api/workspaces",
        json={"name": name, "root_path": str(ws_root)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()
```

### 控制流伪代码

```
Phase 1 — RelationService 服务层测试
  for each test:
    1. 在 db_session 创建 workspace 记录
    2. 调用 RelationService 方法
    3. 断言返回值或异常类型
    4. 可选：再次查询 DB 验证状态

Phase 2 — 循环依赖测试
  1. 创建 A, B, C workspace
  2. 创建循环关系 A→B, B→C, C→A
  3. 验证 list_for_workspace 每个节点的 outgoing/incoming
  4. 验证 TopologyBuilder.build() 包含正确 nodes 和 edges

Phase 3 — TopologyBuilder 测试
  1. 直接调用 TopologyBuilder.build(session)
  2. 验证 nodes 和 edges 内容
  3. 验证 soft-deleted workspace 不在结果中

Phase 4 — Router 补充测试
  1. 使用 client + auth_headers 调用 HTTP 端点
  2. 不带 auth_headers 验证 401
  3. 验证循环依赖通过 HTTP 端点正确存储

Phase 5 — M:N 关联测试
  1. 创建 workspace + change/task/agent_run 记录
  2. 直接插入 M:N 关联记录
  3. 验证 cascade 删除
  4. 验证 composite PK 唯一约束

Phase 6 — context_builder 补充
  1. 创建多 workspace + WorkspaceRelation
  2. 调用 _fetch_referenced_workspaces(session, ws_id, max_depth=N)
  3. 验证 depth 限制和循环安全

Phase 7 — 全量回归
  1. pytest backend/ --tb=short -q
  2. 0 failed, 0 error
```

## 边界处理（必填）

1. **自环拒绝**：`RelationService.create` 当 `source_id == payload.target_id` 时抛出 `RelationSelfLoop`（HTTP 400），不允许 workspace 引用自身。HTTP 层测试验证返回 `code: "HTTP_400_RELATION_SELF_LOOP"`。

2. **UQ 三元组冲突**：同一 `(source_id, target_id, relation_type)` 创建第二条记录时，服务层先手动检查并抛出 `RelationDuplicate`；若竞态通过 DB 层 `ux_workspace_relations_triplet` 索引拦截，`flush` 时 `IntegrityError` 也会被翻译为 `RelationDuplicate`（HTTP 409）。但同一对节点不同 `relation_type` 共存是允许的。

3. **不存在的 workspace**：创建 relation 时 `source_id` 或 `target_id` 指向不存在或 soft-deleted 的 workspace，应抛出 `WorkspaceNotFound`（HTTP 404）。`RelationService.create` 方法内部调用 `WorkspaceService.get(source_id)` 和直接查询 `target_ws` 来验证。

4. **CASCADE 删除**：删除 workspace 后，`workspace_relations` 中 `source_id` 或 `target_id` 指向该 workspace 的记录通过 FK `ondelete="CASCADE"` 自动级联删除。`ChangeWorkspace`/`TaskWorkspace`/`AgentRunWorkspace` 中对应的记录也级联删除。模型定义中所有 FK 均设置了 `ondelete="CASCADE"`。测试通过 `session.delete(ws)` + `session.commit()` 后查询验证。

5. **M:N composite PK 唯一**：`ChangeWorkspace`/`TaskWorkspace`/`AgentRunWorkspace` 使用 `(change_id, workspace_id)` / `(task_id, workspace_id)` / `(agent_run_id, workspace_id)` 作为复合主键，重复插入同一对会触发 `IntegrityError`。测试用 `pytest.raises(Exception)` 断言。

6. **M:N role 字段空值**：`ChangeWorkspace.role` 和 `TaskWorkspace.role` 是 nullable 的 `String(30)`，创建时不传 `role` 应为 `None`，不报错。

7. **拓扑 API 大规模**：TopologyBuilder 在 50+ workspace、100+ relation 场景下的基本正确性验证（不做极限压测），只测试结构和数量正确。

8. **context_builder depth 限制**：`_fetch_referenced_workspaces` 的 `max_depth` 必须 >= 1，否则抛出 `ValueError`。`max_depth=1` 只返回直接关联 workspace，`max_depth=2` 返回二跳可达。循环图 + depth 限制不会无限递归（visited set 去重）。

9. **无认证返回 401**：所有 workspace、relation、topology 端点均受 `require_permission` / `require_permission_any` 保护。不带 `Authorization` header 的请求返回 HTTP 401。

10. **workspace_ids 空列表**：`ChangeRead.workspace_ids` 和 `TaskSummary.workspace_ids` 默认为 `[]`。当 M:N 关联表中无记录时，schema 返回空列表而非 null。`AgentRunResponse.workspace_ids` 同理。

## 非目标（本任务不做的事）

- 不做前端 UI 测试
- 不做性能极限压测（仅做基本的结构正确性验证）
- 不做并发竞态条件测试
- 不做数据库迁移回滚测试（Alembic 迁移在 task-01 中已验证）
- 不做 Redis 依赖的集成测试（SSE streaming 在其他变更中覆盖）
- 不做真实 Agent 执行的端到端测试（只测 context_builder 逻辑和 AgentService 的 M:N enrich）
- 不重写已有的通过测试（workspace CRUD、change reparse、task reparse、scan_docs 等已有用例保留不动）
- 不修改任何源代码实现，只编写测试文件

## 参考

- **设计文档**：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md`
  - ADR-02: Workspace 是唯一基本单元
  - ADR-03: WorkspaceRelation 是自由有向图
  - ADR-04: Change / Task / AgentRun 支持多 Workspace
- **计划文档**：`.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` — Wave 4 验收
- **现有测试模式**（照搬 fixture + 风格）：
  - `backend/app/modules/workspace/tests/test_router.py` — HTTP 测试模式（`AsyncClient` + `auth_headers`）
  - `backend/app/modules/workspace/tests/test_service.py` — 服务层测试模式（`db_session` fixture）
  - `backend/app/modules/workspace/tests/test_relation_router.py` — Relation HTTP 测试（12 个已有用例）
  - `backend/app/modules/workspace/tests/test_model.py` — 模型字段和约束测试
  - `backend/app/modules/agent/tests/test_context_builder.py` — context_builder 完整测试
  - `backend/conftest.py` — 全局 fixture（`db_engine`, `db_session`, `client`, `auth_headers`）
- **数据模型**：`design.md` 中的 `workspace_relations` / `change_workspaces` / `task_workspaces` / `agent_run_workspaces` 表定义
- **API 设计**：`design.md` 中的 WorkspaceRelation + topology 端点定义
- **错误码**：`backend/app/core/errors.py` — `RelationSelfLoop`, `RelationDuplicate`, `RelationNotFound`, `WorkspaceNotFound`

## TDD 步骤

### Phase 1：RelationService CRUD 测试（~30min）

1. **RED**：新建 `test_relation_service.py`，编写所有测试用例（见上方清单）
2. **GREEN**：运行 `pytest backend/app/modules/workspace/tests/test_relation_service.py` 确认全部通过（实现代码在 task-02 已完成）
3. 确认覆盖：create / self-loop / duplicate / not-found / list-outgoing / list-incoming / list-both / list-empty / delete / delete-not-found / all-types

### Phase 2：循环依赖测试（~15min）

4. **RED**：在 `test_relation_service.py` 末尾添加 cycle 测试用例
5. **GREEN**：运行确认通过

### Phase 3：TopologyBuilder 测试（~20min）

6. **RED**：新建 `test_topology.py`，编写拓扑测试用例
7. **GREEN**：运行确认通过

### Phase 4：Router 补充测试（~15min）

8. **RED**：在 `test_relation_router.py` 末尾添加无认证 + 循环 HTTP 测试
9. **GREEN**：运行确认通过

### Phase 5：M:N 关联测试（~40min）

10. **RED**：新建 `test_m2n_change.py`，编写 ChangeWorkspace 测试
11. **GREEN**：运行确认通过
12. **RED**：新建 `test_m2n_task.py`，编写 TaskWorkspace 测试
13. **GREEN**：运行确认通过
14. **RED**：新建 `test_m2n_agent_run.py`，编写 AgentRunWorkspace 测试
15. **GREEN**：运行确认通过

### Phase 6：Scanner 字段验证（~5min）

16. 在 `test_scanner.py` 末尾添加 `ScanResult` 字段存在测试
17. 运行确认通过

### Phase 7：context_builder 补充（~10min）

18. **RED**：在 `test_context_builder.py` 末尾添加 depth=2 测试
19. **GREEN**：运行确认通过

### Phase 8：全量回归（~10min）

20. 运行 `pytest backend/ --tb=short -q`
21. 确认所有测试通过，0 failed，0 error
22. 运行 `pytest backend/ -W error` 检查无新 warning
23. 确认无 component 模块 dangling import

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | RelationService CRUD 测试全部通过 | `pytest test_relation_service.py` — 12 个测试全绿，覆盖 create/list/delete/5 种 relation_type |
| AC-02 | 自环拒绝测试 | `source_id == target_id` 时抛出 `RelationSelfLoop`，HTTP 返回 400 + `code: "HTTP_400_RELATION_SELF_LOOP"` |
| AC-03 | UQ 三元组冲突测试 | 同 `(source_id, target_id, relation_type)` 重复创建抛出 `RelationDuplicate`，HTTP 返回 409 |
| AC-04 | 循环依赖测试 | A→B→A 和 A→B→C→A 正确存储、查询返回双向关系、拓扑 API 包含循环边 |
| AC-05 | TopologyBuilder 空图测试 | 无数据时 `TopologyResponse(nodes=[], edges=[])` |
| AC-06 | TopologyBuilder 有数据测试 | 3 workspace + 2 relation 返回 `len(nodes)==3, len(edges)==2`，edge 字段包含 id/source_id/target_id/relation_type/description |
| AC-07 | TopologyBuilder 排除 soft-deleted | soft-deleted workspace 不在 nodes 中，关联 edge 不在 edges 中 |
| AC-08 | Router 无认证测试 | POST/GET/DELETE relation + GET topology 不带 auth 返回 401 |
| AC-09 | ChangeWorkspace M:N 测试 | 创建/多 workspace 关联/多 change 共享 workspace/role 字段/CASCADE 删除/composite PK 唯一 |
| AC-10 | TaskWorkspace M:N 测试 | 创建/多 workspace 关联/多 task 共享 workspace/role 字段/CASCADE 删除/composite PK 唯一 |
| AC-11 | AgentRunWorkspace M:N 测试 | 创建/多 workspace 关联/CASCADE 删除/composite PK 唯一/enrich_with_workspace_ids 返回正确 workspace_ids |
| AC-12 | AgentRun list_runs 按 workspace 查询 | `AgentService.list_runs(ws1)` 正确过滤只返回关联该 workspace 的 agent_run |
| AC-13 | context_builder depth=2 测试 | A→B→C 时 `max_depth=2` 返回 B 和 C，`max_depth=1` 只返回 B |
| AC-14 | context_builder 循环 + depth 安全 | A→B→C→A + `max_depth=2` 不触发无限递归，A 不在结果中 |
| AC-15 | ScanResult 字段验证 | `ScanResult.parsed_workspaces` 和 `parsed_relations` 字段存在且默认为空列表 |
| AC-16 | 全量 pytest | `pytest backend/ --tb=short -q` 全部通过，0 failed，0 error |
| AC-17 | 无 dangling import | `grep -r "from app.modules.component" backend/app/` 返回空，无 component 模块 import 残留 |
