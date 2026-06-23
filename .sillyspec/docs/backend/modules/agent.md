---
schema_version: 1
doc_type: module-card
module_id: agent
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:08:51
---
# agent
## 定位
AI Agent（Claude Code / GLM 等）执行编排。负责 agent run 生命周期、执行上下文（spec bundle）构建、mission（多 agent 委派）调度，以及与 daemon（运行时租约）协作落地执行。是平台核心执行引擎。
## 契约摘要
- `POST /api/workspaces/{wid}/agent-runs` → 创建 run；`GET /{wid}/agent-runs` / `/sessions`：列表。
- `GET /api/agent-runs/{run_id}/execution-context` → ExecutionContextResponse：组装供 agent 使用的上下文。
- `GET /api/agent-runs/{run_id}` / `/logs` / `/logs/stream`：详情/日志/SSE 流。
- `POST /{run_id}/kill` / `/input` / `/resume` / `/approve`：控制；`GET /{run_id}/checkpoint`。
- `AgentService`：start_run/kill_run/submit_run_input/get_run/list_runs/stream_run_logs(_session_logs)/cleanup_stale_runs/start_stage_dispatch/start_scan_dispatch。
- `ExecutionCoordinatorService`（coordinator.py）：乐观锁 + 指纹校验 + token 校验的协调器。
- `RunPlacementService`（placement.py）：选执行后端（daemon），无在线 daemon 抛 `NoOnlineDaemonError`。
- `MissionService` / `MissionControlService` / `MissionExecutionService`：mission 多步委派执行。
- `build_spec_bundle` / `render_bundle_to_claude_md`（spec_bundle/context_builder）：生成 CLAUDE.md 等 spec 包。
- 模型：AgentRun / AgentRunLog / AgentSession / AgentMission / AgentRunDependency / AgentArtifact。
## 关键逻辑
```
start_run:
  placement = RunPlacementService 选 daemon（无在线→NoOnlineDaemonError）
  _try_acquire_lease 占用 worktree/daemon lease
  build_spec_bundle + render CLAUDE.md
  ExecutionCoordinatorService 启动 → 落 AgentRun
  后台 task 监控 tool failure（monitor_session_tool_failures）
```
## 注意事项
- agent↔daemon 双向引用：agent 选 daemon 运行时，daemon 完成后回调 agent。
- 工具失败监控（`should_warn_tool_failure`）有阈值，超阈值告警但不直接终止。
- kill/resume/approve 有状态前置（AgentRunNotResumable / NotPendingApproval），改状态机需同步。
- spec bundle 是 agent 行为的上下文真相源，改 bundle 渲染会影响所有 run。
## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
