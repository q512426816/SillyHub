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
SillySpec 变更（change）管理：从工作区目录解析变更文档、维护变更与文档记录、驱动阶段（stage）流转与审批、并在 stage 完成后停「待触发」态由 MCP/HTTP 显式推进派发（2026-08-08-change-center-on-demand 起砍掉自动连轴）。
## 契约摘要
- `GET /api/workspaces/{wid}/changes` / `GET /{wid}/changes/{change_id}`：列表/详情。
- `GET /{wid}/changes/{change_id}/documents` / `.../documents/{doc_id}`：变更文档内容。
- `POST /{wid}/changes/reparse` → reparse_changes：重解析磁盘文档回灌 DB。
- `POST /{wid}/changes/{id}/progress` / `/approval` / `/approve` / `/reject` / `/transition` / `/feedback`：进度、审批、阶段转换、反馈。
- `POST /{wid}/changes/{id}/advance-stage`（task-11，D-005）：单步推进 change 阶层，前端 `handleDispatch` 走此 HTTP 入口，body/响应与 `/transition` 对齐（共用 `ChangeService.transition_with_dispatch`，team 分流 single→AgentService / team→`_dispatch_execute_team`）。
- `POST /{wid}/changes/{id}/run-verify-gate`（task-11，D-003/D-008）：gate 软调用，**不硬阻塞、不改 change 状态**，返回 `VerifyGateResponse{exit_code, errors, source}`（source ∈ gate_result/gate_cmd/unavailable），结果交调用方决策。
- `GET /{id}/archive-gate`：归档门禁检查；`POST /proposal-review` / `/plan-review` / `/human-test` / `/archive-confirm`：四节点阶段评审（task-08/13，`submitStageReview` 统一分发，校验经 `StageProjectionService.compute_pending_review`）。
- `ChangeService`：list_/get/get_documents/update_progress/approve/reject/sync_documents/transition(_with_dispatch)/submit_feedback/check_archive_gate/reparse + review 四方法（proposal_review/plan_review/human_test/archive_confirm）+ complete_stage。
- `SillySpecStageDispatchService`（dispatch.py）：`dispatch_next_step`（single/team 分流派发，由 `transition_with_dispatch` 显式调用，不再自动连轴）/ `sync_stage_status`（保留为 sillyspec.db 视图同步——更新 `Change.stages` JSON，**不再驱动 stage 推进**）/ `_dispatch_execute_team` / `_cleanup_before_dispatch` / `_read_latest_gate_result` / `_run_gate_via_delegate`（gate cmd 软调用骨架）/ `reconcile_stale_runs`（仅 stale 清理，剥离推进）/ `cleanup_orphan_dispatch_runs`。
- `StageProjectionService`（projection.py，task-07/10 新增）：`compute_pending_review` 投影当前应做的审核类型（proposal_review/plan_review/human_test/archive_confirm），供 `get_change_stage` MCP tool、review 四方法、review 端点共用校验。
- 模型：Change（含 StageEnum 状态机）/ ChangeDocument。
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
```
## 注意事项
- 阶段流转有状态机（StageEnum + HumanGate），transition / advance-stage 前需过人工门禁（proposal/plan review，校验 `StageProjectionService.compute_pending_review`）。
- **stage 完成停待触发**：AgentRun 跑完 / gate task 跑完只落结果 + 发 SSE，current_stage 不自动推进；必须 MCP `advance_change_stage` / 前端 `advanceChangeStage` 显式触发（D-001，R-01）。
- dispatch 前的清理（`_cleanup_before_dispatch`）保证不会有陈旧 run 永久阻塞新调度。
- reparse 含 rename 检测（`_detect_renames`），避免删重建丢历史。
- change↔workspace 多对多（ChangeWorkspace），跨工作区变更需注意同步。
- `reconcile_stale_runs` 仅清 stale run（释放 `has_active_run`），**不再恢复推进**（D-007，R-07）。
## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-08-change-center-on-demand**（D-001~008 / R-01~07）：砍 `auto_dispatch_next_step` 自动连轴（6 调用点改造见 daemon 模块），stage 完成改「停待触发 + 显式 advance 才推进」。补 4 个 change 阶层 MCP tool（advance_change_stage/submit_stage_review/run_verify_gate/get_change_stage，见 mcp_gateway）+ 2 个对齐 HTTP 端点（advance-stage/run-verify-gate）。gate 硬阻塞改 run_verify_gate 软调用三态（gate_result/gate_cmd/unavailable，D-003/D-008）。sillyspec.db 自动同步改视图同步（`sync_stage_status` 保留但不驱动推进；lease 新增 `_sync_stage_status_from_run` 独立路径不读 db，D-002）。新增 `StageProjectionService.compute_pending_review`（projection.py）作 review 统一校验。`reconcile_stale_runs` 剥离推进只清 stale（D-007）。
<!-- MANUAL_NOTES_END -->
