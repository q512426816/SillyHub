---
schema_version: 1
doc_type: module-card
module_id: task
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务卡与看板（task）

## 定位

变更（change）下的任务卡（`tasks/task-xx.md`）解析、对账与看板。磁盘 frontmatter 是
真相源，reparse 把 `tasks/` 目录 UPSERT 回 DB；平台侧不改任务内容，状态流转入口在
workflow 模块。agent / tool_gateway / workflow 以 task 的 `allowed_paths` 等字段作执
行约束输入。

## 契约摘要

- `GET /api/workspaces/{wid}/changes/{cid}/tasks` —— 列表（过滤 status/owner/
  priority/phase，按 task_key 升序）
- `GET .../tasks/{task_id}` —— 详情（enrich workspace_ids）
- `GET .../tasks/board` —— 看板（按 `BOARD_STATUSES` = draft/ready/in_progress/
  review/done 分组）
- `POST .../tasks/reparse` —— 磁盘对账回灌，返回
  `{parsed, created, updated, deleted}`
- `TaskParser`：glob `{spec_root}/{change.path}/tasks/task-*.md`，文件名抽 task_key，
  frontmatter 解析出 ParsedTask（title/phase/priority/owner/depends_on/blocks/
  affected_components/allowed_paths 等）+ TaskParseWarning
- 表 `tasks`：`(change_id, task_key)` 唯一（`ux_tasks_change_key`）；`workspace_id`
  FK + M:N 关联表 `task_workspaces` 双归属；JSON 列存 affected_components /
  allowed_paths / depends_on / blocks；path/content 存原文

## 关键逻辑

```
reparse(workspace_id, change_id):
  spec_ws = SELECT spec_workspaces WHERE workspace_id   # 无行/无 spec_root
  if spec_ws is None: return 全 0 stats                 # → 不报错直接返回
  parser.parse_tasks(spec_root, change.path)
  按 task_key UPSERT（命中→_apply_parsed，未命中→新建）
  磁盘上消失的 key → session.delete 硬删               # 全量对账式删除
  _sync_task_workspaces 维护 M:N 行
```

## 注意事项

- **spec_root 解析**：reparse 从 `SpecWorkspace.spec_root`（服务器平台侧路径）读文件；
  daemon-client 唯一模式下 backend 读不到客户端 root_path，无 spec_ws 时安静返回全 0
  ——这是刻意行为（2026-07-10-remove-server-local-workspace-mode），不是 bug
- **硬删语义**：与 change 的 scoped reparse（零 delete）不同，task reparse 是全量对账，
  磁盘上消失的任务直接物理删除 DB 行；调用方须知悉
- list_ 查询走"主 workspace FK OR M:N 子查询"双路并去重，任务可经 task_workspaces
  跨工作区引用；enrich_summaries / enrich_with_workspace_ids 补关联展示字段
- 状态字段默认 draft；FSM 流转（draft→ready→…→done 等）校验在 workflow 模块，本模块
  不做状态机校验
- TaskParseWarning 需向调用方透出，便于发现 markdown 格式问题

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
