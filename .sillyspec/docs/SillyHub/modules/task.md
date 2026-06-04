---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# task
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/task/**

## 职责

Task 模块负责 SillySpec 工作流中任务（Task）的生命周期管理：从文件系统解析任务定义、CRUD 操作、任务看板（board）视图、到与 Change 的关联管理。任务是变更（Change）下的可执行单元，对应 `.sillyspec/changes/<change-key>/tasks/` 目录中的 Markdown 文件。

核心能力包括：
- 任务的解析与同步（从 .sillyspec 目录解析 Markdown 任务文件）
- 任务 CRUD（list、get）
- 任务看板视图（按状态/阶段分组的 board 布局）
- 任务与 Workspace 的多对多关联
- 任务与 Change 的归属关系

## 当前设计

模块结构：

```
router.py    → HTTP 接口层（4 个端点）
service.py   → 业务逻辑层（TaskService）
parser.py    → 文件解析器（TaskParser）
model.py     → 数据模型（Task）
schema.py    → Pydantic 请求/响应 schema
tests/       → 测试（router, parser）
```

### 关键类

| 类 | 文件 | 说明 |
|---|---|---|
| `Task` | model.py | 任务主表（SQLModel ORM），含 task_key、title、status、phase、priority、depends_on、blocks 等字段 |
| `TaskService` | service.py | 核心业务服务 |
| `TaskParser` | parser.py | 文件解析器，从 .sillyspec 目录解析任务定义 |
| `ParsedTask` | parser.py | 解析后的任务数据 |
| `TaskParseWarning` | parser.py | 解析警告 |
| `TaskParserResult` | parser.py | 解析结果（tasks + warnings） |

### Task 模型字段

| 字段 | 说明 |
|---|---|
| id | UUID 主键 |
| workspace_id | 所属 workspace |
| change_id | 所属 change |
| task_key | 任务唯一标识（来自文件名） |
| title | 任务标题 |
| status | 任务状态（默认 draft） |
| phase | 阶段 |
| priority | 优先级 |
| owner_key | 负责人标识 |
| estimated_hours | 预估工时 |
| affected_components | 影响的组件列表 |
| allowed_paths | 允许操作的路径列表 |
| depends_on | 依赖的任务列表 |
| blocks | 阻塞的任务列表 |
| path | 文件路径 |
| content | 文件内容 |

### TaskService 方法

| 方法 | 说明 |
|---|---|
| `list_(workspace_id, change_id, status)` | 列出任务（支持按状态过滤） |
| `get(workspace_id, task_id)` | 获取任务详情 |
| `get_board(workspace_id, change_id)` | 获取任务看板视图 |
| `reparse(workspace_id, change_id)` | 重新解析任务（从文件系统同步） |
| `enrich_with_workspace_ids(task)` | 填充 workspace_ids |
| `enrich_summaries(tasks)` | 批量填充 workspace_ids |

## 对外接口（表格）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/workspaces/{workspace_id}/changes/{change_id}/tasks` | 列出任务列表（支持 status 过滤） |
| GET | `/workspaces/{workspace_id}/tasks/{task_id}` | 获取任务详情 |
| GET | `/workspaces/{workspace_id}/changes/{change_id}/tasks/board` | 获取任务看板 |
| POST | `/workspaces/{workspace_id}/changes/{change_id}/tasks/reparse` | 重新解析任务 |

## 关键数据流

```
文件系统 .sillyspec/changes/<change-key>/tasks/<task-key>.md
  → TaskParser.parse_tasks()
    → ParsedTask（frontmatter: title/status/phase/priority/depends_on/blocks 等）
      → TaskService.reparse()
        → _fetch_existing_tasks() 查询已有记录
        → _build_task() / _apply_parsed() 构建/更新 Task
        → _sync_task_workspaces() 多对多关联同步
        → upsert Task 记录
```

```
用户 → router.list_tasks
  → TaskService.list_()
    → 按条件查询 Task
    → enrich_summaries() 填充 workspace_ids
    → 返回 TaskList
```

```
用户 → router.get_task_board
  → TaskService.get_board()
    → 查询所有 tasks
    → 按 status 分组为 TaskBoardColumn
    → 返回 TaskBoard
```

## 设计决策（表格）

| 决策 | 原因 | 备注 |
|---|---|---|
| 文件系统作为 Source of Truth | 与 Change 一致，任务定义在 .sillyspec 目录 | reparse 用于同步 |
| 任务归属 Change | 一个 Change 下有多个 Task | 通过 change_id 外键关联 |
| 多对多 Task-Workspace | 一个 Task 可关联多个 Workspace | TaskWorkspace 中间表 |
| Board 视图按 status 分组 | 适配看板式 UI 展示 | TaskBoard → list[TaskBoardColumn] |
| 解析器独立（TaskParser） | 解析逻辑复杂，与业务逻辑解耦 | 便于单独测试 |
| frontmatter 字段丰富 | depends_on/blocks/priority/phase 支持复杂任务编排 | 从 Markdown frontmatter 解析 |
| 依赖和阻塞使用 task_key 而非 ID | 文件定义阶段 ID 尚未生成 | depends_on/blocks 存储的是 key 字符串列表 |

## 依赖关系

### 内部依赖（被本模块使用）

| 依赖模块 | 用途 |
|---|---|
| `app.core.auth_deps` | 权限校验（require_permission） |
| `app.core.db` | 数据库会话 |
| `app.core.errors` | 错误类型（TaskNotFound） |
| `app.core.logging` | 日志 |
| `app.modules.auth` | User 模型、Permission 权限 |
| `app.modules.change` | ChangeService（查询 Change 信息） |
| `app.modules.workspace` | Workspace、TaskWorkspace 中间表、WorkspaceService |
| `app.models.base` | BaseModel 基类 |

### 被依赖（其他模块使用本模块）

| 使用方模块 | 用途 |
|---|---|
| `agent` | Task 模型用于上下文构建（build_task_context） |
| `change` | Task 概念上属于 Change 的子资源 |
| `change_writer` | 测试中使用 Task 模型 |

## 注意事项

1. **reparse 幂等性**：多次调用 reparse 应产生相同结果（upsert 逻辑）。
2. **depends_on/blocks 是 key 引用**：存储的是 task_key 字符串列表，不是 UUID，运行时需要解析。
3. **change_id 必填**：每个 Task 必须归属一个 Change。
4. **Board 视图性能**：当任务量大时，board 视图需要加载所有任务再分组，可能需要分页优化。
5. **workspace 多对多**：enrich_with_workspace_ids 用于填充响应中的 workspace_ids 列表。

## 变更索引（表格，初始为空）

| 变更 ID | 类型 | 简述 | 日期 |
|---|---|---|---|
