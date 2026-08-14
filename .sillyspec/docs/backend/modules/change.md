---
schema_version: 1
doc_type: module-card
module_id: change
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# change
## 定位
SillySpec 变更（change）管理：从工作区目录解析变更文档、维护变更与文档记录、驱动阶段（stage）流转与审批、并在 stage 完成后停「待触发」态由 MCP/HTTP 显式推进派发（2026-08-08-change-center-on-demand 起砍掉自动连轴）。审批（proposal/plan/human-test/archive-confirm）只落审批记录 + 阶段状态，不再自动派发 agent（2026-08-14-change-center-conversation-driven 起，D-004）；reparse 支持 scoped（零 delete），新变更自动绑定工作区最近活跃会话（change_session_links）。
## 契约摘要
- `GET /api/workspaces/{wid}/changes` / `GET /{wid}/changes/{change_id}`：列表/详情。
- `GET /{wid}/changes/{change_id}/documents` / `.../documents/{doc_id}`：变更文档内容。
- `POST /{wid}/changes/reparse` → reparse_changes：重解析磁盘文档回灌 DB（body 可带 scope 列表做 scoped 重扫，scope 模式零 delete，见 ChangeService.reparse）。
- `POST /{wid}/changes/{id}/progress` / `/approval` / `/approve` / `/reject` / `/transition` / `/feedback`：进度、审批、阶段转换、反馈。
- `POST /{wid}/changes/{id}/advance-stage`（task-11，D-005）：单步推进 change 阶层，前端 `handleDispatch` 走此 HTTP 入口，body/响应与 `/transition` 对齐（共用 `ChangeService.transition_with_dispatch`，team 分流 single→AgentService / team→`_dispatch_execute_team`）。
- `POST /{wid}/changes/{id}/run-verify-gate`（task-11，D-003/D-008）：gate 软调用，**不硬阻塞、不改 change 状态**，返回 `VerifyGateResponse{exit_code, errors, source}`（source ∈ gate_result/gate_cmd/unavailable），结果交调用方决策。
- `GET /{id}/archive-gate`：归档门禁检查；`POST /proposal-review` / `/plan-review` / `/human-test` / `/archive-confirm`：四节点阶段评审（task-08/13，`submitStageReview` 统一分发，校验经 `StageProjectionService.compute_pending_review`）。2026-08-14 起：通过/打回只落审批记录 + 阶段状态**不派发 agent**（D-004）；body 可带 `notify_session`（缺省 true）——审批落库后以服务身份向绑定会话注入审批消息，响应含 `notified_session` / `notify_error`（turn_conflict / session_inactive / inject_failed，best-effort 不回滚审批）。
- `ChangeService`：list_/get/get_documents/update_progress/approve/reject/sync_documents/transition(_with_dispatch)/submit_feedback/check_archive_gate/reparse(scope) + review 四方法（proposal_review/plan_review/human_test/archive_confirm，均带 notify_session 参数）+ complete_stage + _bind_change_to_session（新变更自动绑会话）/ _upsert_projection_progress（投影收敛）/ _record_stage_rework（打回记录不派发）。
- `SillySpecStageDispatchService`（dispatch.py）：`dispatch_next_step`（single/team 分流派发，由 `transition_with_dispatch` 显式调用，不再自动连轴）/ `sync_stage_status`（保留为 sillyspec.db 视图同步——更新 `Change.stages` JSON，**不再驱动 stage 推进**）/ `_dispatch_execute_team` / `_cleanup_before_dispatch` / `_read_latest_gate_result` / `_run_gate_via_delegate`（gate cmd 软调用骨架）/ `reconcile_stale_runs`（仅 stale 清理，剥离推进）/ `cleanup_orphan_dispatch_runs`。
- `StageProjectionService`（projection.py，task-07/10 新增）：`compute_pending_review` 投影当前应做的审核类型（proposal_review/plan_review/human_test/archive_confirm），供 `get_change_stage` MCP tool、review 四方法、review 端点共用校验。
- 模型：Change（含 StageEnum 状态机）/ ChangeDocument / ChangeSessionLink（change↔session 多对多，unique(change_id, session_id)，2026-08-14 新增）。
## 关键逻辑
```
# 形态A：按需触发（2026-08-08-change-center-on-demand）
# stage 完成（AgentRun 跑完 / gate task 跑完）后 change 停「完成待触发」态，
# 由 MCP tool / 前端 HTTP 显式推进，不再 auto_dispatch 自动连轴。
advance_change_stage / POST /advance-stage(workspace, change, target_stage):
  ChangeService.transition_with_dispatch
    → SillySpecStageDispatchService.dispatch_next_step
        ├ _cleanup_before_dispatch(session, change_id)  # 清孤儿/陈旧 run
        ├ if has_active_run: return active_run_exists
        ├ team_mode=True → _dispatch_execute_team(建 team mission)
        └ single → AgentService.start_stage_dispatch(建 AgentRun)
# single stage 完成后 sync_stage_status 仅更新 stages JSON 视图，不推进；
# lease 路径走 daemon 的 _sync_stage_status_from_run（不读 sillyspec.db）。
# gate：run_verify_gate / POST /run-verify-gate 软调用（读 gate_result / 软调 gate cmd），
# exit_code/errors 交调用方决策，不硬阻塞。
#
# 形态B：会话驱动化（2026-08-14-change-center-conversation-driven）
reparse(workspace_id, scope=None):
  scope=None → 全量（含 delete + rename 检测，现状语义）
  scope=[keys] → scoped 零 delete（R-08）：只对命中 key create/update；范围外不进 parsed
    也不判删除；范围内磁盘消失也不删（留全量/手动重扫描收敛）；rename 检测仅全量模式
  created 新变更 → _bind_change_to_session（§8 查询 coalesce(last_active_at, created_at)
    desc 最近活跃会话，跨成员不限 status）→ 写 change_session_links
review 四方法（proposal_review/plan_review/human_test/archive_confirm）:
  通过 → transition（不派发）+ _upsert_projection_progress（upsert platform_change_progress
    source=platform 收敛读侧 latest_progress 投影，R-09）
  打回 → _record_stage_rework（review_history rerun 条目 + last_review + audit，不派发）
  均 → _maybe_notify_session（notify_session=true 时服务身份注入绑定会话，三类降级
    turn_conflict/session_inactive/inject_failed 随响应 notified_session/notify_error 返回）
```
## 注意事项
- 阶段流转有状态机（StageEnum + HumanGate），transition / advance-stage 前需过人工门禁（proposal/plan review，校验 `StageProjectionService.compute_pending_review`）。
- **stage 完成停待触发**：AgentRun 跑完 / gate task 跑完只落结果 + 发 SSE，current_stage 不自动推进；必须 MCP `advance_change_stage` / 前端 `advanceChangeStage` 显式触发（D-001，R-01）。
- dispatch 前的清理（`_cleanup_before_dispatch`）保证不会有陈旧 run 永久阻塞新调度。
- reparse 含 rename 检测（`_detect_renames`），避免删重建丢历史。
- **mtime 防御性转换（ql-20260814-006）**：parser 所有 `st_mtime → datetime` 统一走 `_safe_mtime`（合法窗口外/转换异常回退 epoch 0）。Windows bind mount（Docker Desktop 文件共享层）偶发瞬态脏 mtime（实测 stat 报 year 30828），旧实现单文件脏值即抛 ValueError 打断整个 reparse 500。
- change↔workspace 多对多（ChangeWorkspace），跨工作区变更需注意同步。
- `reconcile_stale_runs` 仅清 stale run（释放 `has_active_run`），**不再恢复推进**（D-007，R-07）。
- **scoped reparse 零 delete（R-08）**：`reparse(scope=[...])` 只 create/update，删除守卫 scope 模式硬关；delete 仅全量 reparse（现状语义）。rename 检测仅全量模式（scoped 部分视图会把范围外变更误判 orphaned）。
- **审批不派发 + 投影收敛（R-09）**：审批通过只 `transition` 不派发 + upsert `platform_change_progress` 收敛读侧投影；打回只 `_record_stage_rework` 落回退记录不派发。`rerun_stage` / `transition_with_dispatch` 保留供 MCP submit_stage_review / advance_change_stage 等外部显式调用方使用。
- **审批-会话注入（R-10）**：审批端点/工具带 `notify_session`（缺省 true），服务身份（`inject_session_as_service`，绕过 `_get_owned_session_for_update` 用户归属 403）注入 `change_session_links` 最新绑定会话；失败三类降级不回滚审批。
## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：砍 `auto_dispatch_next_step` 自动连轴（6 调用点改造见 daemon 模块），stage 完成改「停待触发 + 显式 advance 才推进」。补 4 个 change 阶层 MCP tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage，见 mcp_gateway）+ 2 个对齐 HTTP 端点（advance-stage/run-verify-gate）。gate 硬阻塞改 run_verify_gate 软调用三态（gate_result/gate_cmd/unavailable，D-003/D-008）。sillyspec.db 自动同步改视图同步（`sync_stage_status` 保留但不驱动推进；lease 新增 `_sync_stage_status_from_run` 独立路径不读 db，D-002）。新增 `StageProjectionService.compute_pending_review`（projection.py）作 review 统一校验。`reconcile_stale_runs` 剥离推进只清 stale（D-007）。
- ql-20260809-001-c283 | 修 `ChangeService.complete_stage`（service.py:1571）`stages = change.stages or {}` 非 copy 致 `last_stage_completion` 不落库：`stages` 是普通 `Column(JSON)` 非 `MutableDict.as_mutable`（model.py），原地改 + 回赋同对象，SQLAlchemy set 事件见 `new is old` 不标记 dirty，flush 的 UPDATE 不带 stages 列。改 `dict(change.stages or {})` 浅拷贝（与 `transition_with_dispatch:763` 同源）。回归测试 `test_complete_stage_persists_last_stage_completion_to_db`（refresh 真读 DB 锁持久化）。⚠️ 同文件另有 7 处同模式潜在同 bug（685 transitions / 846 last_feedback / 1327,1386,1457,1621,1718 review_history；934 只读无 bug），本次 scoped 不扩，待 sweep。
- ql-20260809-002-4219 | sweep 关闭 ql-001 的 7 处外溢：`service.py` 全 8 处 `stages = change.stages or {}` → `dict(change.stages or {})`（transition / submit_feedback / proposal_review / plan_review / human_test / rerun_stage / archive_confirm 7 个 mutating 方法 + `check_archive_gate:934` 只读站点一并标准化消除危险 idiom）。关键回归点：bug 仅在 `change.stages` **非空**时触发（falsy 时 `or {}` 取新对象被检测→不触发），新建 `test_stages_persistence.py` 7 用例显式 seed `{"team_mode": True}` 复现，refresh 真读 DB 锁 7 方法 stages 键（transitions / last_feedback / review_history）持久化契约。
- **2026-08-11-change-progress-projection**（D-001~006）：新增 `ChangeService._project_current_stage`（service.py）+ `enrich_summaries`（list 批量 IN join）/ `enrich_with_workspace_ids`（single = 匹配）实时 read-only join `platform_change_progress`（见 platform_sync 模块）取工具上行权威 `current_stage` 覆盖 ChangeSummary/ChangeRead 的猜值（parser 扫文件存在性的 fallback 值）；join 不命中（工具未上行 / quick-uuid8 / workspace_id NULL 过渡行）fallback change 现有值（D-003）；**read-only 不写 changes 表**（D-002，避免与 agent 流程写 changes.current_stage 双写冲突）；**不投 status**（D-004@v2 撤销，sillyspec status 仅 active/archived，archived 已由 current_stage==archive 派生）。投影 join 禁 N+1（R-03，list 一次复合 IN）。`depends_on` 新增 `platform_sync`（read-only join 读其 platform_change_progress 表）。前端零改（ChangeSummary 字段语义不变，仅 current_stage 值变权威）。
- **2026-08-14-change-center-conversation-driven**（D-001~007）：会话驱动化。`ChangeService.reparse(scope)` scoped 零 delete（R-08）；`change/parser.py parse_workspace(scope)` 按 key 集合过滤；created 新变更 `_bind_change_to_session` 自动绑最近活跃会话（§8 SQL，change_session_links 表 + migration 20260814_add_change_session_links）；review 四方法删自动派发——通过走 `transition` + `_upsert_projection_progress`（投影收敛 R-09）、打回走 `_record_stage_rework`，均带 `notify_session`（缺省 true）服务身份注入（`inject_session_as_service`，R-10）；`submit_stage_review` MCP docstring/返回契约同步（agent_dispatch 恒空）。
<!-- MANUAL_NOTES_END -->
