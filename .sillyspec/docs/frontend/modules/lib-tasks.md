---
schema_version: 1
doc_type: module-card
module_id: lib-tasks
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:01:57+08:00
---
# lib-tasks

## 定位
任务（Task）领域 API 客户端（`frontend/src/lib/tasks.ts`，约 100 行）。封装 SillySpec 变更下任务的列表、详情、看板视图与重解析。任务隶属于 change，通过 changeId 过滤。供任务看板与任务详情页消费。

## 契约摘要
- `listTasks(workspaceId, params?): Promise<TaskList>` — 列任务，params 支持 changeId / taskId 过滤。
- `getTask(workspaceId, taskId): Promise<TaskRead>` — 取单个任务（含 allowed_paths / path / content）。
- `getTaskBoard(workspaceId, changeId): Promise<TaskBoard>` — 取某 change 的看板（按 status 分列）。
- `reparseTasks(workspaceId, changeId): Promise<TaskReparseStats>` — 重解析任务。
- 类型：`TaskSummary`（task_key/title/status/phase/priority/owner_key/estimated_hours/affected_components/depends_on/blocks）、`TaskRead`（含 allowed_paths 与正文）、`TaskList`、`TaskBoardColumn`（status/count/items）、`TaskBoard`。

## 关键逻辑
```
listTasks(ws, { changeId?, taskId? }):
  GET /api/workspaces/{ws}/tasks?change_id=&task_id= → { items: TaskSummary[], total }
getTask(ws, taskId): GET /api/workspaces/{ws}/tasks/{taskId} → TaskRead
getTaskBoard(ws, changeId): GET /api/workspaces/{ws}/changes/{changeId}/tasks/board → { columns: [{ status, count, items }] }
reparseTasks(ws, changeId): POST → TaskReparseStats
```

## 注意事项
- 任务始终隶属于某个 change，看板与重解析接口都需 changeId；listTasks 的 changeId 为可选用于跨 change 查询。
- `depends_on` / `blocks` 表达任务间依赖关系，看板渲染与执行顺序调度依赖此信息。
- `TaskRead.allowed_paths` 限定该任务可改动的文件范围，是 agent 执行时的路径白名单。
- 看板按 `status` 分列，每列含 count 与 items；status 取值与 SillySpec 任务状态机一致（如 todo/doing/done 等）。
- `affected_components` 列出任务影响的组件 key，用于跨组件影响面分析。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
