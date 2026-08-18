---
schema_version: 1
doc_type: module-card
module_id: change
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更中心（change）

## 定位
SillySpec 变更中枢：从工作区目录解析变更文档、维护变更/文档/会话绑定/事件记录、驱动阶段
（stage）流转与四节点人工评审，并做读时进度投影。三大现行形态叠加：
①按需触发（2026-08-08 起）——stage 完成停「待触发」，砍自动连轴；
②会话驱动化（2026-08-14 起）——审批只落记录不派发 agent，新变更自动绑定最近活跃会话；
③进度投影（read-only join platform_change_progress，CLI 上行权威 current_stage 覆盖
parser 猜值）。
quicklog 双源合并查询（平台上行条目 × 文件条目）也在本模块。

## 契约摘要
- 列表/详情/文档：
  `GET /{wid}/changes`（批量投影 enrich，禁 N+1）/ `GET /{change_id}` /
  `GET /{change_id}/documents`、`.../documents/{doc_id}`（文档内容）。
- 重解析：`POST /changes/reparse`——body 可带 scope 列表；scoped 模式零 delete、
  rename 检测仅全量模式（见关键逻辑）。
- 文件子域：`GET /{change_id}/files`（变更文件树）、
  `GET|PUT /{change_id}/files/content`（读/写文件内容）、
  `GET /{change_id}/files/pending`（待同步文件）。
- 会话/执行面：`GET /{change_id}/sessions`（绑定会话列表）、
  `GET /{change_id}/agent-status`（当前执行 agent 状态）、
  `POST /{change_id}/dispatch`（显式派发入口）、
  `PATCH /{change_id}/stage-profile`（阶段级 profile 绑定，落
  `stages[<stage>].profile_id`）。
- 平台同步消费面（daemon/CLI 上行写进来的对偶端点）：`POST /{change_key}/progress`、
  `GET|POST /{change_key}/approval`、`POST /{change_key}/approve`、
  `POST /{change_key}/reject`、`GET|POST /{change_key}/documents`。
- 阶段推进：`POST /{change_id}/transition`（手动转换）、
  `POST /{change_id}/advance-stage`（单步推进，与 transition 共用
  `transition_with_dispatch`，single→AgentService / team→mission 分流）、
  `POST /{change_id}/run-verify-gate`（gate 软调用三态
  gate_result/gate_cmd/unavailable，不硬阻塞不改状态）、
  `GET /{change_id}/archive-gate`（归档门禁检查）、
  `POST /{change_id}/feedback`。
- 四节点评审：`POST /{change_id}/proposal-review` / `plan-review` / `human-test` /
  `archive-confirm`——校验统一走 `StageProjectionService.compute_pending_review`；
  body 可带 `notify_session`（缺省 true），响应含 `notified_session` / `notify_error`。
- quicklog 读面：`GET /quicklog-entries`、`GET /quicklog-entries/{ql_id}`。
- 服务层：
  - `ChangeService`：list/get/update_progress/approve/reject/
    transition(_with_dispatch)/submit_feedback/check_archive_gate/reparse(scope)/
    complete_stage + review 四方法 + `_bind_change_to_session` / `_project_current_stage` /
    `enrich_summaries`（批量 IN 投影）/ `enrich_with_workspace_ids` /
    `_upsert_projection_progress` / `_record_stage_rework` / `_maybe_notify_session`。
  - `SillySpecStageDispatchService`（dispatch.py）：`dispatch`（single/team 分流派发）、
    `get_config_for_stage`（StageAgentConfig 每阶段 agent 配置）、
    `_dispatch_execute_team`（含 GLM 可用性回退 `_run_glm_fallback_mission`）、
    `merge_gate_results`（合并 worker gate）、`_read_latest_gate_result`、
    `read_verify_result`、gate cmd 软调用骨架（`_run_gate_via_delegate` /
    `_read_gate_result`）、`reconcile_stale_runs`（仅清 stale 不推进）、
    `cleanup_orphan_dispatch_runs` / `cleanup_stale_pending_runs`、
    `has_active_run`、chain 计数（`_get/_increment/_reset_chain_count` 防派发链失控）。
  - `StageProjectionService`（projection.py）：`compute_pending_review` 投影当前应做
    审核类型——review 四方法 / review 端点 / MCP `get_change_stage` 共用校验。
  - `QuicklogQueryService`（quicklog_service.py）：`merge_entries` /
    `list_entries` / `get_entry`——`QuicklogMergedEntry` 统一
    `_from_pushed_payload`（平台上行）与 `_from_file_entry`（QUICKLOG 文件解析）两源，
    `derive_stale` 推过期、`_enrich_authors` 批量补作者。
- 解析层：`parser.py`（`parse_workspace(scope)` 按 key 集合过滤）、
  `quicklog_parser.py`。
- 模型：changes（`StageEnum` 阶段 / `ChangeStatus` / `StageStatus` / `StepStatus`
  枚举族，stages JSON 视图）、change_documents、change_session_links
  （unique(change_id, session_id)）、change_events（ChangeEventORM 事件流）。

## 关键逻辑
```
advance-stage → transition_with_dispatch → dispatch:
  _cleanup_before_dispatch(清孤儿/陈旧 run) → has_active_run? 拒
  team → _dispatch_execute_team(建 team mission; 主 agent 不可用回退 GLM)
  single → AgentService.start_stage_dispatch(建 AgentRun)

reparse(scope):
  scope=None 全量(delete + _detect_renames 重命名检测)
  scope=[keys] 零 delete: 只对命中 key create/update, 范围内磁盘消失也不删
  created 新变更 → _bind_change_to_session(coalesce(last_active_at,
    created_at) desc 最近活跃会话, 跨成员) → 写 change_session_links

review 四方法(通过/打回):
  通过 → transition(不派发) + _upsert_projection_progress(upsert
    platform_change_progress source=platform, 收敛读侧 latest_progress 投影)
  打回 → _record_stage_rework(review_history rerun 条目, 不派发)
  均 → _maybe_notify_session(notify_session=true 时服务身份注入绑定会话)

读侧投影: _project_current_stage 只读 join platform_change_progress
  覆盖 current_stage; 不写 changes 表; 不投 status; join 不命中
  (工具未上行/过渡行)回退 change 现值
```

## 注意事项
- stage 完成停待触发：AgentRun/gate task 跑完只落结果 + 发 SSE，current_stage 不自动推进；
  必须 MCP `advance_change_stage` / 前端 advance-stage / dispatch 显式触发。
- `sync_stage_status` 只更新 `Change.stages` JSON 视图、不驱动推进；lease 路径走 daemon 的
  `_sync_stage_status_from_run`（从 AgentRun 推导，不读 sillyspec.db）。
- 审批不派发（会话驱动化 D-004）：通过只 transition + 投影收敛，打回只
  `_record_stage_rework`；`rerun_stage`/`transition_with_dispatch` 保留给 MCP/HTTP
  显式调用方。
- scoped reparse 零 delete 是会话驱动化的命门（增量同步不触发整树 reparse）：删除守卫
  scope 模式硬关，delete 仅全量 reparse；rename 检测仅全量（scoped 部分视图会把范围外
  变更误判 orphaned）。
- `Change.stages` 是普通 JSON Column 非 MutableDict：所有原地改必须
  `dict(change.stages or {})` 浅拷贝再回赋，否则 SQLAlchemy set 事件见 `new is old`
  不标 dirty、flush 静默丢更新（历史 8 处已标准化；`test_stages_persistence.py`
  7 用例守护，新代码沿用该范式）。
- parser 的 `st_mtime → datetime` 统一 `_safe_mtime`（Windows bind mount 瞬态脏 mtime
  防御——实测 stat 偶报 year 30828，脏值回退 epoch 0，防单文件打断整个 reparse 500）。
- 审批-会话注入走 daemon `inject_session_as_service`（服务身份绕过用户归属 403）；
  失败三类降级（turn_conflict/session_inactive/inject_failed）best-effort 不回滚审批。
- 投影 join 禁 N+1：list 走 `enrich_summaries` 一次复合 IN；单条走
  `enrich_with_workspace_ids`。
- change↔workspace 多对多（ChangeWorkspace），跨工作区变更注意同步语义。
- 用户可见错误文案中文（error-message-l10n）；守护测试 `test_error_message_l10n.py`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
