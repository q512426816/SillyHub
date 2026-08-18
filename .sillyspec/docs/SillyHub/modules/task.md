---
schema_version: 1
doc_type: module-card
module_id: task
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 任务解析与查询（task）

## 定位
SillySpec 变更下「任务」的解析与查询层。
任务对应 spec 树 `changes/<change>/tasks/<task-key>.md`，**文件是 source of truth**；
本模块把 frontmatter 解析落库，供看板 / 详情页 / 编排链路快速查询。
状态流转不在本模块（由 workflow.transition_task 驱动），执行上下文由 agent 模块取用。

## 契约摘要
- 路由 `prefix=/workspaces/{workspace_id} tag=task`：
  - `GET /changes/{change_id}/tasks` 列表（可选 status 过滤，返回 `TaskList`）
  - `GET /tasks/{task_id}` 详情（`TaskRead`，含 workspace_ids 与完整 markdown content）
  - `GET /changes/{change_id}/tasks/board` 看板（`TaskBoard`，按 status 分组的
    `TaskBoardColumn[]`，列序按状态流转顺序排）
  - `POST /changes/{change_id}/tasks/reparse` 重解析
    （`TaskReparseResponse`：stats + warnings）
- 数据 `Task`（tasks 表）：
  workspace_id / change_id / task_key / title / status（默认 draft）/
  phase / priority / owner_key / estimated_hours /
  affected_components[] / allowed_paths[] / depends_on[] / blocks[] /
  path / content
- 中间表 `TaskWorkspace`（Task ↔ Workspace 多对多，表定义在 workspace 模块 model）
- 解析产物（parser.py，独立于 service 可单测）：
  `ParsedTask` / `TaskParseWarning` / `TaskParserResult`

## 关键逻辑
reparse（`TaskService.reparse`）：
```
spec_ws = 查 SpecWorkspace（无 spec_root → 零解析，返回空 stats）
parsed = TaskParser.parse_tasks(spec_root, change.path)   # 读服务器 spec_root
按 task_key 对账 upsert（_build_task 新建 / _apply_parsed 刷旧行）
磁盘上消失的行 → session.delete（硬删）；同步 TaskWorkspace 关联
```
- **解析源是服务器 SpecWorkspace.spec_root（扁平布局），不是 repo 本地路径**：
  daemon-client 唯一模式下 backend 读不到成员宿主机 root_path
  （2026-07-10-remove-server-local-workspace-mode）
- parser 读 tasks/*.md frontmatter（title/status/phase/priority/depends_on/blocks/
  owner_key/estimated_hours/affected_components/allowed_paths），
  task_key 取文件名去 .md——它是跨文件引用键；
  title 缺失回退首个 H1（`_extract_h1`）；解析问题记入 `TaskParseWarning` 随响应返回
- `enrich_with_workspace_ids` / `enrich_summaries` 批量填 workspace_ids，避免 N+1
- board 全量加载后按 status 分组，任务量大时无分页，需注意查询成本

## 注意事项
- reparse 对磁盘消失的任务是**硬删**（session.delete）而非软删，DB 永远向文件对齐
- depends_on / blocks 存 task_key 字符串引用（非 UUID）——文件定义阶段 ID 尚未生成；
  运行时才解析映射，跨 change 不解析
- 每个 task 必归属一个 change（change_id 必填）；change 删除需级联处理其下 task
- reparse 同时刷新 TaskWorkspace 多对多关联，保证关联表最新
- 状态默认 draft，经 workflow 的 TaskFSM 流转
  （draft→ready→in_progress→review→done，含 blocked/cancelled 分支），本模块不改状态
- affected_components 影响模块影响分析；allowed_paths 限定 task 可操作的代码路径
  （tool_gateway 的 validate_path 消费）
- 前端 lib/tasks.ts 四函数与四端点一一对应

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
