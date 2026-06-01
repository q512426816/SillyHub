---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# task

> 最后更新：2026-05-31
> 最近变更：feat(task): task board view + reparse with M:N workspace sync
> 模块路径：`app/modules/task/**`

## 职责

管理任务看板：从文件系统解析 `tasks/task-xx.md`、DB 持久化、列表查询（支持多维过滤）、看板分组展示、Reparse 同步、M:N 工作区关联。

## 当前设计

### 架构

```
TaskService（业务层）
  ├── TaskParser（文件系统解析）— tasks/ 目录下 .md 文件解析
  ├── get_board() — 看板列分组（draft/ready/in_progress/review/done）
  ├── reparse() — UPSERT 模式同步
  └── _sync_task_workspaces() — M:N 工作区关联同步
```

### 关键逻辑

1. **Reparse**：解析 `changes/{location}/{change_key}/tasks/*.md`，UPSERT Task 行，删除消失的行
2. **看板分组**：固定 5 列 `BOARD_STATUSES = [draft, ready, in_progress, review, done]`，额外状态动态追加
3. **M:N 关联**：通过 `affected_components` 匹配 `Workspace.component_key` 自动建立关联
4. **Enrichment**：`enrich_summaries()` / `enrich_with_workspace_ids()` 填充 `workspace_ids` 列表
5. **去重**：`list_()` 查询主 workspace FK + M:N 可能重叠，需内存 `seen` 集合去重

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `GET /workspaces/{ws}/changes/{cid}/tasks` | `list_tasks()` | 列出任务（支持 status/owner/priority/phase 过滤） | 前端 |
| `GET /workspaces/{ws}/tasks/{id}` | `get_task()` | 获取单个任务详情 | 前端 |
| `GET /workspaces/{ws}/changes/{cid}/tasks/board` | `get_task_board()` | 看板视图（按状态分组） | 前端 |
| `POST /workspaces/{ws}/changes/{cid}/tasks/reparse` | `reparse_tasks()` | 从文件系统重新解析任务 | 前端 |

## 关键数据流

```
GET /changes/{cid}/tasks/board → TaskService.get_board()
  → change_service.get(ws_id, change_id)  # 校验 change 存在
  → list_(ws_id, change_id)              # 获取全部 tasks
  → 按 BOARD_STATUSES 分组
  → 返回 [{status, count, items}, ...]
```

```
POST /changes/{cid}/tasks/reparse → TaskService.reparse()
  → change_service.get() + workspace_service.get()  # 校验存在
  → TaskParser.parse_tasks(sillyspec_root, change_path)
  → 遍历 parsed tasks:
    → 已存在 → _apply_parsed()（UPDATE）
    → 不存在 → _build_task() + add（INSERT）
    → _sync_task_workspaces()   # M:N 同步
  → 删除未出现的 tasks（硬删除）
  → COMMIT
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| 硬删除消失的 tasks | 与 change reparse 不同，task 生命周期短、重建成本低 | service.py `reparse` |
| 看板固定 5 列 | 前端看板布局稳定，额外状态动态追加不破坏 UI | service.py `BOARD_STATUSES` |
| M:N 关联基于 component_key | 跨工作区任务通过 affected_components 自动发现 | service.py `_sync_task_workspaces` |
| Task 数据存 content 字段 | 任务 markdown 全文存储便于前端渲染，无需二次读文件 | model.py `content` |

## 依赖关系

### 依赖本模块
- `worktree/service.py`：获取 task_id 关联
- `agent/service.py`：AgentRun 关联 task
- 前端任务看板页面

### 本模块依赖
- `change/service`：ChangeService 校验 change 存在
- `workspace/service`：WorkspaceService 校验 workspace + M:N 查询
- `workspace/model`：TaskWorkspace M:N 表
- `task/parser`：TaskParser 文件系统解析器
- `core/errors`：TaskNotFound

## 注意事项

- `enrich_summaries()` 对每个 task 单独查询 M:N 表，MVP 规模可接受，后续需批量查询优化
- Task 没有 PATCH/PUT 端点，状态变更通过 reparse 从文件系统同步
- `allowed_paths`、`depends_on`、`blocks` 存为 JSON 数组，由 parser 从 markdown frontmatter 解析
- 列表查询按 `task_key` 字母排序，task_key 格式为 `task-xx`

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-31 | 初始归档 | 从代码逆向生成模块文档 |
