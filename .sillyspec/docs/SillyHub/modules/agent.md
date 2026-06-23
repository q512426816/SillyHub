---
schema_version: 1
doc_type: module-card
module_id: agent
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:33
---
# agent

## 定位
后端「Agent 运行时编排」功能域：把一次 SillySpec 阶段执行（stage dispatch）或独立任务派发成一条 AgentRun，落到在线 daemon 上执行，并管理 mission（多 worker 协同）、幂等/断点续跑、审批、日志流、工具失败监控。是连接「变更工作流」与「本地 daemon 执行」的中枢。

## 契约摘要
- API（tag=agent）：`POST /api/agent/runs`（创建 run）、`POST /api/agent/runs/{id}/kill`、`POST /api/agent/runs/{id}/input`（提交用户输入）、quick-chat、`GET .../runs/{id}/logs/stream`（SSE 日志流）、missions 系列（`POST /missions/{id}/cancel` 等）。
- `AgentService`：核心服务，`start_run` / `start_stage_dispatch` / `start_scan_dispatch` / `kill_run` / `submit_run_input` / `stream_run_logs` / `cleanup_stale_runs`。通过 `RunPlacementService` 选择在线 daemon，`NoOnlineDaemonError` 表示无可用 runtime。
- `ExecutionCoordinatorService`：幂等与断点续跑。`check_idempotency`、`compute_fingerprint`/`validate_fingerprint`（AgentSpecBundle 指纹）、`generate_resume_token`、`resume_run`、`save_checkpoint`/`load_checkpoint`、`request_approval`/`approve`。
- `MissionService` + `MissionControlService`：mission 生命周期（多 worker），`derive_status` 聚合 worker 状态，`can_dispatch_worker` 做并发/成本预算校验，`cancel` 取消。
- `MissionExecutionService`：单 worker 执行，`dispatch_worker`（含 read_only 工具配置）、`collect_artifact` / `collect_completed_artifacts`。
- 与 daemon 的协作：`start_run` 成功后通过 `DaemonWsHub` 通知 daemon 领任务；日志/事件经 daemon 上行回流。

## 关键逻辑
```
# 阶段派发主流程（start_stage_dispatch）
解析 stage 配置 → acquire worktree lease（需写盘时）→ ensure change dir in worktree
→ AgentService.start_run → RunPlacementService 选 daemon
→ DaemonWsHub.notify_task_available → daemon claim → run 进入 running
# 幂等与续跑
check_idempotency(key) 命中则返回既有 run；否则 compute_fingerprint 入库
运行中断 → resume_run(token) → validate_fingerprint → load_checkpoint 续跑
# 工具失败监控
aggregate_tool_failure(logs) → should_warn_tool_failure(threshold) → 告警
```

## 注意事项
- run 与 lease 强耦合：`start_run` 需要写盘时会 `acquire worktree lease`，daemon 完成后通过 lease complete 回调驱动 stage 完结（`_trigger_stage_completion_callback`）。
- fingerprint 变更（AgentSpecBundle 内容变）会使旧 resume token 失效；幂等 key 用于防止同阶段重复派发。
- `cleanup_stale_runs` / `reconcile_stale_runs` 定时清理卡死 run，daemon 重启后靠 `recover_session_after_daemon_restart` 收敛。
- 工具失败监控阈值 `_failure_threshold()` 受配置驱动，前端据此提示风险。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
