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
SillySpec 变更（change）管理：从工作区目录解析变更文档、维护变更与文档记录、驱动阶段（stage）流转与审批、并与 agent 调度联动（dispatch）。
## 契约摘要
- `GET /api/workspaces/{wid}/changes` / `GET /{wid}/changes/{change_id}`：列表/详情。
- `GET /{wid}/changes/{change_id}/documents` / `.../documents/{doc_id}`：变更文档内容。
- `POST /{wid}/changes/reparse` → reparse_changes：重解析磁盘文档回灌 DB。
- `POST /{wid}/changes/{id}/progress` / `/approval` / `/approve` / `/reject` / `/transition` / `/feedback`：进度、审批、阶段转换、反馈。
- `GET /{id}/archive-gate`：归档门禁检查；`POST /proposal-review` / `/plan-review`：阶段评审。
- `ChangeService`：list_/get/get_documents/update_progress/approve/reject/sync_documents/transition(_with_dispatch)/submit_feedback/check_archive_gate/reparse。
- `SillySpecStageDispatchService`（dispatch.py）：`dispatch_next_step` 自动调度下一阶段 agent run；`sync_stage_status` / `read_verify_result` / `reconcile_stale_runs` / `cleanup_orphan_dispatch_runs`。
- 模型：Change（含 StageEnum 状态机）/ ChangeDocument。
## 关键逻辑
```
dispatch_next_step(workspace, change, stage):
  config = STAGE_AGENT_CONFIG[stage]
  _cleanup_before_dispatch(session, change_id)  # 清孤儿/陈旧 run
  if has_active_run: return active_run_exists
  bundle = _build_stage_bundle(...)
  AgentRun → 启动执行 → 返回结果
```
## 注意事项
- 阶段流转有状态机（StageEnum + HumanGate），transition 前需过人工门禁（proposal/plan review）。
- dispatch 前的清理（`_cleanup_before_dispatch`）保证不会有陈旧 run 永久阻塞新调度。
- reparse 含 rename 检测（`_detect_renames`），避免删重建丢历史。
- change↔workspace 多对多（ChangeWorkspace），跨工作区变更需注意同步。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
