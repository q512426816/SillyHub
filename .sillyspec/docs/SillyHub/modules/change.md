---
schema_version: 1
doc_type: module-card
module_id: change
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 变更工作流核心（change）

## 定位
后端「变更（change）」功能域：SillySpec 变更工作流的核心。解析工作区 `.sillyspec/changes/` 目录为变更视图并入库，管理变更 CRUD、文档矩阵、变更文件读写、阶段流转与人工审核门、按需 Agent 派发、进度同步投影、反馈、归档门槛、quicklog 视图、变更-会话绑定。
变更中心已会话驱动化：新建变更走会话（change_writer 的 HTTP 表单入口已下线），阶段推进以 CLI/daemon 上报的进度为准、平台按需显式触发派发。

不负责：变更文档生成写盘（change_writer）、agent 执行与消息上行（agent/daemon）、进度接收端点（platform_sync）、任务/看板视图（task）。

## 契约摘要
- **变更视图**：
  - 列表（排序白名单防 SQL 注入、pending_review 状态镜像 platform 进度、按名/态过滤）/详情（key 或 id）。
  - 文档矩阵与单文档内容；重解析（全量重扫 + rename 检测 + `_sync_docs` 增量同步入库 + 占位行过滤）。
  - 阶段档案配置更新（update_stage_profile）、agent 状态视图（get_agent_status）。
- **变更文件**：文件树列表 / 读内容 / 写内容（`_enqueue_edit_write` 经 daemon host_fs 通道下发，写后 `_resync_change_docs` 回灌文档矩阵）/ pending 文件列表——会话驱动模式下平台侧读写 agent 写盘结果的口。
- **阶段流转与审核**：
  - `transition`（FSM `can_transition` 校验）/ `advance_stage`（阶段推进，可带 agent_profile_id 透传派发）/ `complete_stage` + `rerun_stage`（返回结构化结果）。
  - 四类人工审核面板：`proposal_review / plan_review / human_test / archive_confirm`（pending_review 停靠态的放行/打回，打回走 `_record_stage_rework`）。
  - `submit_feedback`（反馈落变更）；`check_archive_gate`（归档门槛）；审批 get/approve/reject（注入服务身份）。
  - `run_verify_gate`：在 daemon 侧跑 `sillyspec gate verify`（host_fs delegate），kickback 记录失败原因。
- **派发**（dispatch.py）：
  - `transition_with_dispatch` → `dispatch_next_step` 显式按需派发——auto_dispatch 自动连轴已砍（形态A 按需触发）。
  - `_dispatch_execute_team` 多 worker execute 团队；GLM 兜底 mission（主 agent 选 GLM 且可用时的降级路径）；`_read_latest_gate_result`/`merge_gate_results` 汇总 gate 结果。
  - `get_config_for_stage` 读阶段 agent 配置（requires_worktree 等）；`load_prompt_template` 从 prompts/ 读阶段提示词模板。
  - 收敛：`reconcile_stale_runs`（只清理不推进）/ `cleanup_orphan_dispatch_runs` / `cleanup_stale_pending_runs` / `reconcile_pending_gate_decisions`；`sync_stage_status` 与 `_sync_stage_status_daemon_client` 双向同步 sillyspec.db 阶段状态。
- **进度投影**：
  - projection.py `StageProjectionService`——只读（mode=ro）sillyspec.db 的 stages 完成事件，把人工门状态投影为四类审核面板之一；db 不存在/change 不在/读取失败一律返回 None 降级，绝不写 CLI 的库。
  - service `_project_current_stage`——列表/详情读时批量 join `platform_change_progress` 取权威 current_stage/completed_stages/latest_progress（复合 IN 防 N+1），读时投影覆盖落库值。
- **解析器**（parser.py）：目录 → ParsedChange/ParsedDoc/ParseWarning；`_infer_change_type` 与 `_infer_affected_components` 读 `_module-map.yaml` 把变更涉及文件路径反查回模块 id。
- **quicklog**：quicklog_parser 解析 QUICKLOG 文件 + quicklog_service 与平台同步条目（platform_sync 上行）合并的查询视图（列表/单条）。
- **会话绑定**：`_bind_change_to_session`（ChangeSessionLink）+ `_maybe_notify_session`/`_notify_bound_session`——阶段/审核事件回推绑定会话。
- **数据**：Change / ChangeDocument / ChangeSessionLink / ChangeEventORM（归属事件链）；StageEnum + `can_transition` FSM。

## 关键逻辑
```
# 解析与模块反查
parse_workspace(spec_root) → change 目录 → _infer_affected_components(文件路径→模块 id, 靠 _module-map.yaml paths)

# 阶段流转 + 按需派发
transition → can_transition/审核门 → transition_with_dispatch → dispatch_next_step
→ AgentService.start_stage_dispatch → daemon claim 执行 → 完成回调推阶段

# 人工审核门
StageProjectionService(sillyspec.db 只读) → stage completed 事件 → 投影为 4 类面板之一
service.proposal_review/plan_review/human_test/archive_confirm → 通过则 complete_stage 推进

# 读时投影（current_stage 双轨）
list/get → _project_current_stage 批量 join platform_change_progress → 权威 current_stage 覆盖落库值
```

## 注意事项
- 模块影响分析完全依赖 `_module-map.yaml` 的 paths glob 准确性；paths 不准则受影响模块判定漏报（归档前模块影响分析的输入）。
- current_stage 双轨控制是刻意设计：平台写落库字段 + 读时投影覆盖 CLI 上报镜像；CLI daemon 模式不主动推进度，落库值与投影值短暂不一致不是 bug。
- 同一 change 不会并发派发多条 run：派发前 `has_active_run` + `cleanup_before_dispatch`。
- 变更文件写内容走 daemon host_fs 下发，daemon 离线时写路径不可用；读有 `_resync_change_docs` 回灌语义，勿绕过。
- quick 类型变更走独立 quick 阶段（不进 brainstorm→plan→execute→verify→archive 主线），gate 判定与审核面板需区分（gate 仅 verify 适用）。
- projection 对 sillyspec.db 绝不写（D-002）；投影失败静默降级，勿在调用侧补抛异常。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
