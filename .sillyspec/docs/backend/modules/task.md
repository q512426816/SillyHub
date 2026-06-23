---
schema_version: 1
doc_type: module-card
module_id: task
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# task
## 定位
SillySpec 任务（task）管理：从变更目录解析任务 markdown、维护任务记录与看板视图、支持重解析回灌。任务挂在 change 之下，是 agent 执行的具体单元。
## 契约摘要
- `GET /api/workspaces/{wid}/tasks`：任务列表（可按 change 过滤）。
- `GET /{wid}/tasks/{task_id}` → TaskRead：任务详情。
- `GET /{wid}/tasks/board` → TaskBoard：看板视图（按状态分组）。
- `POST /{wid}/tasks/reparse` → reparse_tasks：重解析磁盘任务回灌 DB。
- `TaskService`：list_/get/get_board/reparse + enrich_with_workspace_ids/enrich_summaries。
- `TaskParser`（parser.py）：parse_tasks / _parse_task_file / _extract_h1，产出 ParsedTask + TaskParseWarning。
- 模型：Task（归属 change）。
## 关键逻辑
```
reparse(workspace_id):
  从 change 目录读 tasks/*.md
  parser.parse_tasks → ParsedTask[]
  _apply_parsed: 对比 _fetch_existing_tasks → upsert/删除
  _sync_task_workspaces: 维护 TaskWorkspace 关联
  返回 {created, updated, deleted}
```
## 注意事项
- 任务无独立阶段机，状态由 markdown frontmatter 解析得出，reparse 是唯一真相源。
- Task↔Workspace 多对多（TaskWorkspace），任务可跨工作区引用。
- enrich 系列方法负责补 workspace_ids 等关联字段供前端展示，勿在 model 上冗余。
- 解析告警（TaskParseWarning）需在前端透出，便于发现 markdown 格式问题。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
