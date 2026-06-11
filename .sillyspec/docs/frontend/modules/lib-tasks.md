---
schema_version: 1
doc_type: module-card
module_id: lib-tasks
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-tasks

## 定位
Task（任务）API 客户端。

## 契约摘要
- `listTasks(workspaceId, params?)` — 列出任务（支持 changeId/taskId 过滤）
- `getTask(workspaceId, taskId)` — 获取单个任务
- `getTaskBoard(workspaceId, changeId)` — 获取任务看板
- `reparseTasks(workspaceId, changeId)` — 重新解析任务

## 关键逻辑
- 调用 `/api/workspaces/{id}/tasks` 系列端点
- 任务关联到 change，通过 changeId 过滤

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
