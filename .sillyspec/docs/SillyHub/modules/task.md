---
schema_version: 1
doc_type: module-card
module_id: task
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# task

## 定位
SillySpec 工作流中「任务」的解析与生命周期管理服务。任务（Task）是变更（Change）下的可执行单元，对应 `.sillyspec/changes/<change-key>/tasks/<task-key>.md`。负责从 markdown 解析任务定义、CRUD、看板视图、与 workspace 的多对多关联同步。是 spec 文档管理链路的「任务索引层」。

产品视角：任务是 spec 工作流「计划→执行」的承载体。用户在变更详情页看到任务列表与看板，workflow 模块驱动任务状态流转，agent 执行时取任务上下文。任务定义写在 markdown frontmatter（含依赖/阻塞/优先级/影响组件），文件是 source of truth，本模块把它解析落库供快速查询与编排。

## 契约摘要
- 路由：`APIRouter prefix=/workspaces/{workspace_id} tag=task`
  - `GET /changes/{change_id}/tasks` 列表（支持 status 过滤，返回 `TaskList`）
  - `GET /tasks/{task_id}` 详情（返回 `TaskRead`，含 workspace_ids）
  - `GET /changes/{change_id}/tasks/board` 看板（按 status 分组的 `TaskBoard` → `list[TaskBoardColumn]`）
  - `POST /changes/{change_id}/tasks/reparse` 重解析
- 数据：`Task`（task_key / title / status 默认 draft / phase / priority / owner_key / estimated_hours / depends_on / blocks / affected_components / allowed_paths / path / content）
- 中间表：`TaskWorkspace`（Task ↔ Workspace 多对多）
- 解析产物：`ParsedTask` / `TaskParseWarning` / `TaskParserResult`
- 依赖：`core`、`models`、`workspace`（Workspace/TaskWorkspace）、`change`（ChangeService 查 change）；被 `workflow.transition_task` 驱动状态、`agent` 取任务上下文（build_task_context）
- 跨组件协作：前端 `lib/tasks.ts` + 变更详情页任务标签 + 看板视图；workflow 用 TaskFSM 校验状态迁移

## 关键逻辑
重解析与看板（`TaskService`）：
```
parsed = TaskParser.parse_tasks(change_dir)   # 读 tasks/*.md frontmatter
existing = _fetch_existing_tasks(change_id)   # 按 path 对账
for p in parsed: upsert Task + _apply_parsed
_sync_task_workspaces(task, parsed.workspaces) # M2M 关联同步
board: query tasks → 按 status 分组成 TaskBoardColumn[]
```
- 文件系统是 source of truth，reparse 幂等 upsert
- depends_on/blocks 存 task_key 字符串列表（非 UUID），运行时解析，文件定义阶段 ID 尚未生成
- `_extract_h1` 从 markdown 提取 H1 作为 title，缺失回退 frontmatter
- `_sync_task_workspaces` 维护 Task ↔ Workspace 多对多关联
- board 视图查全部任务按 status 分组，适配看板式 UI

### Parser 解析细节
`TaskParser` 从 `.sillyspec/changes/<change-key>/tasks/*.md` 解析：
- `parse_tasks(change_dir)` 遍历 tasks 目录，对每个 `.md` 调 `_parse_task_file`
- `_parse_task_file` 读 frontmatter（YAML）提取 title/status/phase/priority/depends_on/blocks/owner_key/estimated_hours/affected_components/allowed_paths
- `_extract_h1` 取首个 H1 作 title 兜底
- `TaskParseWarning` 记录解析问题（缺字段/格式错），随 result.warnings 返回
- task_key 取文件名（去 .md），作为跨文件引用键

## 注意事项
- reparse 会软删磁盘上消失的任务文件对应行，保持 DB 与文件一致
- `enrich_with_workspace_ids` / `enrich_summaries` 填充响应中的 workspace_ids 列表
- board 视图加载全部任务再分组，任务量大时可能需分页优化
- depends_on/blocks 是 key 引用，非 ID，跨 change 不解析，运行时需解析映射
- 每个任务必须归属一个 change（change_id 必填），change 删除需级联处理
- 任务状态默认 draft，经 workflow.transition_task 流转（draft→ready→in_progress→review→done，含 blocked/cancelled）
- frontmatter 字段丰富（priority/phase/depends_on/blocks）支持复杂任务编排
- TaskParser 独立于 service，便于单独测试解析逻辑
- `_build_task` 构造新 Task 行，`_apply_parsed` 刷已有行字段，二者保证 upsert
- `_fetch_existing_tasks` 按 change_id 查已有行，供 reparse 对账
- list_ 支持 change_id + status 过滤，返回 TaskSummary 列表
- get 返回 TaskRead，enrich_with_workspace_ids 填 workspace_ids
- board 的 TaskBoardColumn 按 status 分组，每列含任务卡片列表
- reparse 同步 TaskWorkspace 关联表，保证多对多关系最新
- task_key 由文件名派生，是 frontmatter 中 depends_on/blocks 的引用键
- list_ 的 status 过滤可选，不传返回全部状态任务
- get 返回完整 content 字段，供详情页展示 markdown 原文
- board 的 TaskBoardColumn 列序按状态流转顺序排
- enrich_summaries 批量填 workspace_ids，避免 N+1 查询
- Task 与 change 是多对一，change 删除时需级联处理其下 task
- 前端 lib/tasks.ts 四函数与后端端点一一对应
- task 的 estimated_hours 供工时统计
- affected_components 列表影响模块影响分析
- allowed_paths 限定 task 可操作的代码路径
- TaskParser.parse_tasks 对空 tasks 目录返回空 result
- board 按状态流转顺序排列列，便于看板推进

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
