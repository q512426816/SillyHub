---
schema_version: 1
doc_type: module-card
module_id: lib-tasks
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务读侧客户端（lib-tasks）

## 定位

workspace 任务（task card）读侧 API 客户端：任务详情、看板视图、重解析三个端点。
写侧的 task 状态流转在 lib-workflow（`transitionTask`），不在本模块。

## 契约摘要

- `getTask(workspaceId, taskId)` — `GET /api/workspaces/{wid}/tasks/{tid}` → `TaskRead`。
- `getTaskBoard(workspaceId, changeId)` —
  `GET /api/workspaces/{wid}/changes/{cid}/tasks/board` → `TaskBoard`（列=状态）。
- `reparseTasks(workspaceId, changeId)` —
  `POST .../changes/{cid}/tasks/reparse` → `TaskReparseResponse`。
- 类型 `TaskSummary` / `TaskRead` / `TaskList` / `TaskBoardColumn` / `TaskBoard` /
  `TaskParseWarning` / `TaskReparseStats` / `TaskReparseResponse` 全部从 OpenAPI
  生成的 `@/lib/api-types` 取（后端 `backend/app/modules/task/schema.py`）。

## 关键逻辑

```
三个薄封装: apiFetch(<REST path>, reparse 加 method: POST)
类型 = components["schemas"][...] 直引，无手写类型
```

## 注意事项

- 生成的 `TaskSummary` / `TaskRead` 比旧手写多 `workspace_ids: string[]`（超集，
  读侧消费者忽略即可）；`TaskParseWarning.task_key` 在 schema 中为可选。
- 旧卡的 `listTasks(workspaceId, params?)` 已不存在——列表需求统一走
  `getTaskBoard`（按 change 分组），别按旧卡引用。
- 消费方为 workspace 页面域（任务看板页 / 任务详情页）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
