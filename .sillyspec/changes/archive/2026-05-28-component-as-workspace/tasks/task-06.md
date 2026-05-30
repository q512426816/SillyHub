---
author: qinyi
created_at: 2026-05-29T17:40:00+08:00
id: task-06
title: "Agent 跨空间上下文构建 — 基于 WorkspaceRelation 拉取 spec 摘要"
priority: P1
estimated_hours: 3
depends_on: [task-02]
blocks: [task-08]
allowed_paths:
  - backend/app/modules/agent/base.py
  - backend/app/modules/agent/context_builder.py
  - backend/app/modules/agent/schema.py
  - backend/app/modules/agent/tests/test_context_builder.py
---

# task-06: Agent 跨空间上下文构建 — 基于 WorkspaceRelation 拉取 spec 摘要

## 背景

依据文档：`.sillyspec/changes/2026-05-28-component-as-workspace/design.md` ADR-05

当前 `context_builder.py` 的 `build_spec_bundle()` 只加载当前 workspace 自身的 spec 文档（ChangeDocument、SpecWorkspace 策略/版本）。Agent 在执行跨组件任务时缺乏对关联 workspace 的上下文感知，例如：

- A 服务依赖 B 库的 API 定义
- 测试组件依赖被测组件的接口规范
- 文档组件引用多个服务的 spec

本任务通过 `WorkspaceRelation` 有向图，在构建 `AgentSpecBundle` 时自动拉取关联 workspace 的 spec 摘要，注入到 bundle 的 `referenced_workspaces` 字段中。

## 修改文件

| 文件 | 操作 | 说明 |
|---|---|---|
| `backend/app/modules/agent/base.py` | 修改 | 新增 `WorkspaceSpecSummary` dataclass；`AgentSpecBundle` 新增 `referenced_workspaces` 字段 |
| `backend/app/modules/agent/context_builder.py` | 修改 | 新增 `_fetch_referenced_workspaces()` 函数；`build_spec_bundle()` 调用并注入摘要；`render_bundle_to_claude_md()` 渲染新段 |
| `backend/app/modules/agent/schema.py` | 修改 | 新增 `WorkspaceSpecSummaryDTO` 响应 schema |
| `backend/app/modules/agent/tests/test_context_builder.py` | 新增 | 上下文构建 + 跨空间拉取的单元测试 |

## 实现要求

### 1. 新增 `WorkspaceSpecSummary` dataclass (base.py)

在 `AgentSpecBundle` 类定义之前新增：

```python
@dataclass
class WorkspaceSpecSummary:
    """Lightweight summary of a related workspace's spec material.

    This is a runtime-only structure — it is never persisted. The context
    builder populates it by following WorkspaceRelation edges and reading
    spec files from the related workspace's spec_root.
    """

    workspace_id: uuid.UUID
    name: str
    slug: str
    component_key: str | None
    relation_type: str           # depends_on, consumes_api_from, ...
    direction: str               # "outgoing" or "incoming"
    spec_root: str | None        # from SpecWorkspace.spec_root
    doc_summaries: dict[str, str]  # doc_type -> content snippet (first N chars)
```

### 2. 扩展 `AgentSpecBundle` (base.py)

在 `AgentSpecBundle` 的 `# --- Cross-workspace context (runtime-only) ---` 区域新增字段：

```python
    # --- Cross-workspace context (runtime-only) ---
    referenced_workspaces: list[WorkspaceSpecSummary] = field(default_factory=list)
```

### 3. 新增 `_fetch_referenced_workspaces()` 函数 (context_builder.py)

在 `build_spec_bundle()` 之前新增私有异步函数。

### 4. 修改 `build_spec_bundle()` (context_builder.py)

在 "5. Assemble bundle" 步骤之前调用 `_fetch_referenced_workspaces()`，并将结果传入 `AgentSpecBundle(referenced_workspaces=referenced)`。

### 5. 修改 `render_bundle_to_claude_md()` (context_builder.py)

在 "Available Tools" 段之前增加 "Referenced Workspaces" 段，渲染每个关联 workspace 的 name、relation_type、direction（用箭头符号）、component_key、spec_root 和 doc_summaries。

### 6. 新增 `WorkspaceSpecSummaryDTO` (schema.py)

Pydantic DTO，字段与 dataclass 一致，用于 API 响应传输。

## 接口定义

### `_fetch_referenced_workspaces` — 完整签名

```python
async def _fetch_referenced_workspaces(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    max_depth: int = 1,
    snippet_max_chars: int = 2000,
) -> list[WorkspaceSpecSummary]:
```

**输入参数：**

| 参数 | 类型 | 必填 | 默认值 | 说明 |
|---|---|---|---|---|
| `session` | `AsyncSession` | 是 | -- | SQLAlchemy 异步会话 |
| `workspace_id` | `uuid.UUID` | 是 | -- | 主 workspace ID |
| `max_depth` | `int` | 否 | `1` | 遍历深度，必须 >= 1 |
| `snippet_max_chars` | `int` | 否 | `2000` | 每个文档摘要最大字符数 |

**返回值：** `list[WorkspaceSpecSummary]` -- 关联 workspace 的 spec 摘要列表，按遇到顺序排列。

**控制流伪代码：**

```
1. 校验 max_depth >= 1，否则抛 ValueError
2. 初始化 visited = {workspace_id}, frontier = []
3. 查询 workspace_relations 表（source_id = workspace_id OR target_id = workspace_id）
4. 遍历 relations：
   a. 判断 direction：source_id == workspace_id → outgoing，否则 incoming
   b. related_id = 对端 workspace_id
   c. 如果 related_id in visited → 跳过
   d. 加入 visited，加入 frontier
5. 如果 max_depth > 1，对 frontier 中每个节点做 BFS 扩展（同上查询逻辑），直到 depth == max_depth
6. 对 frontier 中每个 (related_id, relation_type, direction)：
   a. 查 workspaces 表获取 name/slug/component_key
   b. 跳过 deleted_at IS NOT NULL 或 status == "deleted" 的 workspace
   c. 查 spec_workspaces 表获取 spec_root（可能不存在 → None）
   d. 查 scan_documents 表（exists=True）获取文档列表
   e. 对每个文档：优先使用 content 列，fallback 读文件路径（_read_file_safe）
   f. 截取前 snippet_max_chars 字符
   g. 组装 WorkspaceSpecSummary
7. 返回 results 列表
```

**数据库查询（4 条 SQL）：**

```sql
-- Step 3: 查所有关联 relation
SELECT * FROM workspace_relations
WHERE source_id = :wid OR target_id = :wid

-- Step 6a: 查关联 workspace 信息
SELECT * FROM workspaces WHERE id = :related_id

-- Step 6c: 查 SpecWorkspace
SELECT * FROM spec_workspaces WHERE workspace_id = :related_id

-- Step 6d: 查 scan documents
SELECT * FROM scan_documents
WHERE workspace_id = :related_id AND exists = true
ORDER BY doc_type ASC
```

**direction 判定逻辑：**

- `relation.source_id == workspace_id` → `direction = "outgoing"`
- `relation.target_id == workspace_id` → `direction = "incoming"`

### `WorkspaceSpecSummary` -- dataclass 字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `workspace_id` | `uuid.UUID` | 关联 workspace 主键 |
| `name` | `str` | workspace 显示名 |
| `slug` | `str` | URL 友好标识 |
| `component_key` | `str | None` | 组件标识（如 api-gateway） |
| `relation_type` | `str` | 关系类型：depends_on / consumes_api_from / tests / publishes_to / documents |
| `direction` | `str` | "outgoing" 或 "incoming" |
| `spec_root` | `str | None` | SpecWorkspace.spec_root |
| `doc_summaries` | `dict[str, str]` | doc_type -> 内容摘要（截取前 N 字符） |

### `AgentSpecBundle` 新增字段

| 字段 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `referenced_workspaces` | `list[WorkspaceSpecSummary]` | `[]` | 运行时构建，不落库 |

### `render_bundle_to_claude_md` 新增渲染段

在 "Available Tools" 段之前，渲染格式：

```markdown
## Referenced Workspaces
### → {name} ({relation_type})
- **component_key**: {component_key}
- **spec_root**: {spec_root}
- **{doc_type}**:
  {snippet line 1}
  {snippet line 2}
```

其中 `→` 用于 outgoing，`←` 用于 incoming。

## 边界处理

### E1: 无关联 workspace -- 空图

当 workspace 没有任何 `workspace_relations` 记录时（出边和入边均为空），`_fetch_referenced_workspaces()` 应直接返回空列表 `[]`，不抛异常。bundle 中 `referenced_workspaces` 为空列表，不影响其他字段。

### E2: 关联 workspace 已软删除（status=deleted / deleted_at IS NOT NULL）

查询 `workspaces` 表时，如果目标 workspace 的 `deleted_at IS NOT NULL` 或 `status = 'deleted'`，则跳过该 workspace，不纳入摘要。在 BFS 遍历中也不将其作为下一层遍历的起点。

### E3: 关联 workspace 无 SpecWorkspace 记录

某些 workspace 可能还没有 `spec_workspaces` 行（如新创建但未完成 spec 初始化的 workspace）。此时 `spec_root` 设为 `None`，`doc_summaries` 设为空 dict `{}`，仍然生成摘要条目（至少包含 name/slug/component_key/relation_type/direction），不抛异常。

### E4: spec 文档文件不存在或读取失败

调用 `_read_file_safe()` 读取文档内容时，文件可能不存在、权限不足、或编码异常。`_read_file_safe` 已处理这些情况并返回 `None`。在组装 `doc_summaries` 时跳过 `None` 值的文档，不纳入摘要 dict。优先使用 `ScanDocument.content` 列（数据库已有内容），仅当 content 为 None 时才 fallback 到读文件。

### E5: 循环依赖导致重复访问

WorkspaceRelation 允许循环（A depends_on B 且 B depends_on A）。BFS 遍历时使用 `visited: set[uuid.UUID]` 记录已处理的 workspace_id，确保每个 workspace 最多被摘要一次。`max_depth` 参数进一步限制遍历深度，防止在大规模图中遍历过深。如果 `max_depth` 传入 <= 0，抛出 `ValueError("max_depth must be >= 1")`。

### E6: snippet_max_chars 边界值

如果 `snippet_max_chars <= 0`，不截取任何内容，`doc_summaries` 中所有条目的值为空字符串 `""`。如果 `snippet_max_chars > 文件实际长度`，返回完整文件内容（Python 切片 `[:n]` 自然处理）。

### E7: 同一对 workspace 存在多种 relation_type

两个 workspace 之间可能同时存在 `depends_on` 和 `consumes_api_from` 两种关系。在 `visited` 去重时，同一个 workspace_id 只产生一条 `WorkspaceSpecSummary`，`relation_type` 取第一次遇到的关系。后续如需表达多种关系可扩展为 `list[str]`，但本任务中只记录第一条。

### E8: workspace_id 指向不存在的 workspace

查询 `workspaces` 表返回 None 时（理论上被 FK 约束保护，但防御性编程），跳过该条目，不抛异常。

## 非目标

- **不做事件联动/自动触发**：只做上下文拉取，不做 workspace 变更时自动通知 agent
- **不做 SharedSpecDocument**：不引入共享文档概念，只基于现有 WorkspaceRelation
- **不做 relation_type 权重排序**：不按 relation_type 优先级排序摘要，按自然遍历顺序返回
- **不做 spec 文档差异对比**：只读取当前快照，不与历史版本对比
- **不做 API 端点**：`WorkspaceSpecSummaryDTO` 仅作为内部传输结构，不暴露为独立 REST 端点
- **不做前端展示**：本任务仅涉及后端 context_builder 逻辑

## 参考

| 来源 | 路径 | 相关内容 |
|---|---|---|
| 设计文档 ADR-05 | `.sillyspec/changes/2026-05-28-component-as-workspace/design.md` | 跨空间引用基于 WorkspaceRelation |
| 计划文档 | `.sillyspec/changes/2026-05-28-component-as-workspace/plan.md` | task-05 定义（W3, P1, 3h, 依赖 task-02） |
| 现有 context_builder | `backend/app/modules/agent/context_builder.py` | `build_spec_bundle()` 函数，`_read_file_safe()` 辅助函数 |
| Agent 数据结构 | `backend/app/modules/agent/base.py` | `AgentSpecBundle`, `TaskContext` |
| Workspace 模型 | `backend/app/modules/workspace/model.py` | Workspace 表（含 component_key, deleted_at, status），WorkspaceRelation 表（source_id, target_id, relation_type） |
| SpecWorkspace 模型 | `backend/app/modules/spec_workspace/model.py` | spec_workspaces 表（spec_root, strategy, profile_version） |
| ScanDocument | `backend/app/modules/scan_docs/model.py` | scan_documents 表（doc_type, content, path, exists） |

## TDD 步骤

### Step 1: 编写 `WorkspaceSpecSummary` 和 `AgentSpecBundle` 扩展的测试

文件：`backend/app/modules/agent/tests/test_context_builder.py`

```python
# test_workspace_spec_summary_creation
# - 构造 WorkspaceSpecSummary 实例
# - 验证所有 8 个字段可正常赋值
# - 验证 doc_summaries 可包含内容

# test_workspace_spec_summary_default_doc_summaries
# - 构造 WorkspaceSpecSummary（不传 doc_summaries）
# - 验证 doc_summaries 默认值为空 dict

# test_agent_spec_bundle_has_referenced_workspaces
# - 构造 AgentSpecBundle（不传 referenced_workspaces）
# - 验证 referenced_workspaces 默认值为空 list
# - 构造含 WorkspaceSpecSummary 的 bundle
# - 验证可以赋值 list[WorkspaceSpecSummary]
```

### Step 2: 编写 `_fetch_referenced_workspaces` 的测试（核心）

```python
# test_fetch_referenced_workspaces_no_relations
# - 创建 workspace，无任何 relation
# - 调用 _fetch_referenced_workspaces(session, ws_id)
# - 断言返回空列表

# test_fetch_referenced_workspaces_outgoing_relation
# - 创建 ws_a, ws_b；创建 relation A->B (depends_on)
# - 调用 _fetch_referenced_workspaces(session, ws_a.id)
# - 断言返回 [WorkspaceSpecSummary]，direction="outgoing", relation_type="depends_on"
# - 断言 name="B", slug="b", component_key 匹配

# test_fetch_referenced_workspaces_incoming_relation
# - 创建 ws_a, ws_b；创建 relation A->B (consumes_api_from)
# - 调用 _fetch_referenced_workspaces(session, ws_b.id)
# - 断言返回 [WorkspaceSpecSummary]，direction="incoming"

# test_fetch_referenced_workspaces_skips_deleted_workspace
# - 创建 ws_a, ws_deleted（status="deleted", deleted_at=now）
# - 创建 relation A->deleted
# - 调用 _fetch_referenced_workspaces(session, ws_a.id)
# - 断言返回空列表

# test_fetch_referenced_workspaces_skips_no_spec_workspace
# - 创建 ws_a, ws_b；创建 relation A->B
# - ws_b 无 SpecWorkspace 记录
# - 断言仍返回摘要，spec_root=None, doc_summaries={}

# test_fetch_referenced_workspaces_reads_doc_snippets
# - 创建 ws_a, ws_b + ScanDocument(content="...") for ws_b
# - 调用 _fetch_referenced_workspaces(session, ws_a.id, snippet_max_chars=2000)
# - 断言 doc_summaries 包含 doc_type 和截取后的内容

# test_fetch_referenced_workspaces_snippet_truncation
# - 创建 ScanDocument(content="x" * 5000)
# - 调用 _fetch_referenced_workspaces(session, ws_a.id, snippet_max_chars=100)
# - 断言 snippet 长度 == 100

# test_fetch_referenced_workspaces_circular_dependency
# - 创建 A->B 和 B->A
# - 调用 _fetch_referenced_workspaces(session, ws_a.id)
# - 断言 B 只出现一次，A 不出现在结果中，不无限递归

# test_fetch_referenced_workspaces_invalid_max_depth
# - max_depth=0 和 max_depth=-1
# - 断言抛出 ValueError("max_depth must be >= 1")

# test_fetch_referenced_workspaces_multiple_relations_same_pair
# - 创建 A->B (depends_on) 和 A->B (consumes_api_from)
# - 断言 B 在结果中只出现一次（workspace_id 去重）

# test_fetch_referenced_workspaces_zero_snippet_chars
# - 创建 ScanDocument(content="Some content")
# - snippet_max_chars=0
# - 断言 doc_summaries 值为空字符串 ""
```

### Step 3: 编写 `build_spec_bundle` 集成测试

```python
# test_build_spec_bundle_includes_referenced_workspaces
# - 创建 ws_a（含 SpecWorkspace）+ ws_b（含 component_key）+ WorkspaceRelation A->B
# - 创建 Change + Task（关联 ws_a）
# - 调用 build_spec_bundle(session, change_id, task_id, ws_a.id)
# - 断言 bundle.referenced_workspaces 包含 B 的摘要

# test_build_spec_bundle_no_relations_empty_list
# - 创建 ws（含 SpecWorkspace），无 relation
# - 创建 Change + Task
# - 断言 bundle.referenced_workspaces == []
```

### Step 4: 编写 `render_bundle_to_claude_md` 测试

```python
# test_render_bundle_includes_referenced_workspaces_section
# - 构造含 referenced_workspaces 的 bundle（outgoing, 含 doc_summaries）
# - 渲染为 markdown
# - 断言包含 "## Referenced Workspaces" 标题
# - 断言包含 workspace name 和 relation_type
# - 断言包含 component_key、spec_root、doc_type
# - 断言 outgoing 用 → 符号

# test_render_bundle_referenced_workspaces_incoming_arrow
# - 构造含 incoming direction 的 bundle
# - 断言渲染结果包含 ← 符号

# test_render_bundle_no_referenced_workspaces
# - referenced_workspaces 为空
# - 渲染结果不包含 "## Referenced Workspaces" 段
```

### Step 5: 实现代码使测试通过

1. 在 `base.py` 中新增 `WorkspaceSpecSummary` dataclass（在 `TaskContext` 之前）
2. 在 `base.py` 中给 `AgentSpecBundle` 添加 `referenced_workspaces` 字段
3. 在 `context_builder.py` 中实现 `_fetch_referenced_workspaces()`（BFS 遍历 + 去重 + 摘要构建）
4. 修改 `build_spec_bundle()` 在 "Assemble bundle" 之前调用 `_fetch_referenced_workspaces()`
5. 修改 `render_bundle_to_claude_md()` 在 "Available Tools" 之前渲染 "Referenced Workspaces" 段
6. 在 `schema.py` 中新增 `WorkspaceSpecSummaryDTO`

### Step 6: 运行全量测试

```bash
cd backend && python -m pytest app/modules/agent/tests/test_context_builder.py -v
cd backend && python -m pytest app/modules/agent/ -v
cd backend && python -m pytest -x -q
```

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 检查 `base.py` 中 `WorkspaceSpecSummary` dataclass 定义 | 存在完整定义，包含 8 个字段：workspace_id, name, slug, component_key, relation_type, direction, spec_root, doc_summaries |
| AC-02 | 检查 `AgentSpecBundle.referenced_workspaces` 字段 | 类型为 `list[WorkspaceSpecSummary]`，默认值为 `field(default_factory=list)` |
| AC-03 | 运行 `test_fetch_referenced_workspaces_no_relations` | 通过，返回空列表 `[]` |
| AC-04 | 运行 `test_fetch_referenced_workspaces_outgoing_relation` | 通过，direction="outgoing"，name/slug/component_key 匹配 ws_b |
| AC-05 | 运行 `test_fetch_referenced_workspaces_incoming_relation` | 通过，direction="incoming"，relation_type="consumes_api_from" |
| AC-06 | 运行 `test_fetch_referenced_workspaces_skips_deleted_workspace` | 通过，已软删除的 workspace 不出现在结果中 |
| AC-07 | 运行 `test_fetch_referenced_workspaces_skips_no_spec_workspace` | 通过，spec_root=None, doc_summaries={}，不抛异常 |
| AC-08 | 运行 `test_fetch_referenced_workspaces_circular_dependency` | 通过，workspace 去重，A 不出现在结果中，B 只出现一次 |
| AC-09 | 运行 `test_fetch_referenced_workspaces_reads_doc_snippets` + `snippet_truncation` | 通过，snippet 不超过 `snippet_max_chars` 字符 |
| AC-10 | 运行 `test_fetch_referenced_workspaces_zero_snippet_chars` | 通过，`snippet_max_chars=0` 时 doc_summaries 值为空字符串 |
| AC-11 | 运行 `test_fetch_referenced_workspaces_invalid_max_depth` | 通过，`max_depth=0` 和 `-1` 均抛出 `ValueError("max_depth must be >= 1")` |
| AC-12 | 运行 `test_fetch_referenced_workspaces_multiple_relations_same_pair` | 通过，同一对 workspace 只产生一条摘要 |
| AC-13 | 运行 `test_build_spec_bundle_includes_referenced_workspaces` | 通过，bundle.referenced_workspaces 包含 ws_b 的摘要 |
| AC-14 | 运行 `test_build_spec_bundle_no_relations_empty_list` | 通过，bundle.referenced_workspaces == [] |
| AC-15 | 运行 `test_render_bundle_includes_referenced_workspaces_section` | 通过，输出包含 "## Referenced Workspaces"、workspace name、relation_type、→ 符号 |
| AC-16 | 运行 `test_render_bundle_referenced_workspaces_incoming_arrow` | 通过，输出包含 ← 符号 |
| AC-17 | 运行 `test_render_bundle_no_referenced_workspaces` | 通过，输出不包含 "## Referenced Workspaces" 段 |
| AC-18 | 检查 `schema.py` 中 `WorkspaceSpecSummaryDTO` | 存在 Pydantic schema，字段与 dataclass 一致 |
| AC-19 | 运行 `cd backend && python -m pytest -x -q` | 全量测试通过，无失败 |
| AC-20 | 检查无新增数据库表/迁移 | `referenced_workspaces` 仅为运行时字段，不落库 |
