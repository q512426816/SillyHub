---
schema_version: 1
doc_type: module-card
module_id: agent
source_commit: 9656307c
author: qinyi
created_at: 2026-06-24T01:08:51
---
# agent
## 定位
AI Agent（Claude Code / GLM 等）执行编排。负责 agent run 生命周期、执行上下文（spec bundle）构建、mission（多 agent 委派）调度，以及与 daemon（运行时租约）协作落地执行。是平台核心执行引擎。
## 契约摘要
- `POST /api/workspaces/{wid}/agent-runs` → 创建 run；`GET /{wid}/agent-runs` / `/sessions`：列表。
- `GET /api/workspaces/{wid}/agent-sessions?include_ended=`（2026-08-14 扩展）：缺省 false = 现状 active-only 最小字段 dict；`include_ended=true` = 工作区全量会话（含已结束，软删过滤）完整 `AgentSessionListItem`（id/provider/status/turn_count/author/last_active_at/title，对齐 daemon/schema.py:71-84），排序 coalesce(last_active_at, created_at) desc，跨成员可见。
- `GET /api/agent-runs/{run_id}/execution-context` → ExecutionContextResponse：组装供 agent 使用的上下文。
- `GET /api/agent-runs/{run_id}` / `/logs` / `/logs/stream`：详情/日志/SSE 流。
- `POST /{run_id}/kill` / `/input` / `/resume` / `/approve`：控制；`GET /{run_id}/checkpoint`。
- `AgentService`：start_run/kill_run/submit_run_input/get_run/list_runs/stream_run_logs(_session_logs)/cleanup_stale_runs/start_stage_dispatch/start_scan_dispatch。
- `ExecutionCoordinatorService`（coordinator.py）：乐观锁 + 指纹校验 + token 校验的协调器。
- `RunPlacementService`（placement.py）：选执行后端（daemon），无在线 daemon 抛 `NoOnlineDaemonError`。
- `MissionService` / `MissionControlService` / `MissionExecutionService`：mission 多步委派执行。
- `dispatch_worker`（execution.py / mcp_tools.py / router.py，2026-08-08-dispatch-worker-caller-worktree）：可选参 `worktree_path`/`branch`/`worker_prompt`（caller-worktree / 路径A）；`worktree_path` 非空 → 跳过 `git_worktree_add` 并作 daemon `root_path`，且**不写 `run.worktree_branch`**（D-008，防 finalize 误 merge caller 主仓）；`worker_prompt` 非 None → 覆写 `render_worker_prompt`。
- `create_mission`（router.py / mission_schema.py）：`orchestration_mode: Literal["team","external"]|None=None`；并入 `constraints`，team 门控放行 external 进 `team_mission_entry` 但跳过 orchestrator run/lease spawn（D-007 / R-02）。
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
dispatch_worker caller-worktree（路径A，2026-08-08-dispatch-worker-caller-worktree）:
  worktree_path 非空 → 短路 git_worktree_add + 作 daemon root_path
  路径A 不写 run.worktree_branch（D-008，防 finalize 误 merge caller 主仓）
  worker_prompt 非 None → 覆写 render_worker_prompt（caller 注入 no-commit / 不越界）

mission external 模式（R-01 三重防御，防 caller 主仓被误 merge / finalize）:
  ① team_mission_entry: constraints.orchestration_mode=="external" → 跳过 orchestrator run + lease spawn
  ② converge_mission_for_completed_run: 检测 external → 跳过 finalize_execute_mission + cleanup_mission（不 merge / 不清 caller worktree）
  ③ 路径A 不写 worktree_branch（即便误进 finalize 也无 branch 可 merge）
## 注意事项
- **用户可见错误文案中文（2026-08-15-error-message-l10n）**：本模块面向前端用户的 raise message 已全部中文化（中文短语+行动指引，技术 ID 在 details）；守护测试 tests/core/test_error_message_l10n.py 强制新文案含 CJK。
- agent↔daemon 双向引用：agent 选 daemon 运行时，daemon 完成后回调 agent。
- 工具失败监控（`should_warn_tool_failure`）有阈值，超阈值告警但不直接终止。
- kill/resume/approve 有状态前置（AgentRunNotResumable / NotPendingApproval），改状态机需同步。
- spec bundle 是 agent 行为的上下文真相源，改 bundle 渲染会影响所有 run。
## 人工备注
<!-- MANUAL_NOTES_START -->
- **2026-08-13-profile-system-prompt-injection**（已归档）：profile.system_prompt 经 SDK `systemPrompt={preset:claude_code, append}` 注入 agent（废弃 D-012@v2 claudeMd prepend）；`_apply_profile_to_lease` 写 lease.metadata.system_prompt（service.py，空不写键零回归）。stageProfileId 每阶段独立持久化 `change.stages[<stage>].profile_id` + PATCH `/changes/{id}/stage-profile`。
- **ql-20260814-001** 平台角色模板全部下线：CC×5 移除（GLM×5 此前 ql-20260813-005 已下线）。`profile/seed.py` `_ROLE_TEMPLATE_PROVIDERS` 清空，`ensure_role_template_profiles` 不再补种、仅按 `_DEPRECATED_ROLE_TEMPLATE_IDS`（GLM+CC 共 10 确定性 UUID）回收 DB 残留。系统默认档案（Claude Code 默认 / Codex 默认，`is_system_default=True`）不受影响。
- **2026-08-14-change-center-conversation-driven**（D-002@v1 / task-06）：`GET /{wid}/agent-sessions` 加 `include_ended: bool = False` 参数——false 保持 active-only 最小字段（审批中心聚合用）；true 返回全量 `AgentSessionListItem`（含已结束，`_build_workspace_session_items` + `_assemble_workspace_session_items`：批量取作者展示名 + 首条 user_input 标题前 30 字，防 N+1）。不新增双端点。
<!-- MANUAL_NOTES_END -->
