---
author: qinyi
created_at: 2026-06-14T17:25:44
change: 2026-06-14-unified-agent-execution
stage: propose
---

# Tasks — 统一 Agent 执行路径（Daemon-Only）

> 任务只列名称 + 文件路径，细节（Wave 分组、依赖、步骤）在 plan 阶段展开。

## Phase 1 — 删除 SERVER 执行路径

- T1.1 删除 claude_code.py 命令构建 / stdin / 解析 / subprocess（保留 `AgentAdapter` ABC 于 base.py） — `backend/app/modules/agent/adapters/claude_code.py`
- T1.2 删除 service.py 三条 SERVER 执行体 + `_proc_registry` + kill SIGTERM→SIGKILL 链 — `backend/app/modules/agent/service.py`
- T1.3 `decide_backend` 去 SERVER 分支 + 新增 `NoOnlineDaemonError`（携带 workspace_id/user_id） — `backend/app/modules/agent/placement.py`
- T1.4 删除 `RunPlacementService.dispatch_to_server` — `backend/app/modules/agent/placement.py`

## Phase 2 — execution-context 端点 + dispatch 扩字段

- T2.1 新增 `GET /agent-runs/{run_id}/execution-context`（复用 `build_spec_bundle`/`build_scan_bundle` + `render_bundle_to_claude_md`） — `backend/app/modules/agent/router.py`
- T2.2 `dispatch_to_daemon`（`placement.py:124`）签名扩 `repo_url/branch/allowed_paths/tool_config/timeout_seconds` — `backend/app/modules/agent/placement.py`
- T2.3 `_build_claim_payload` 透传 bundle 字段（从 lease.metadata 读） — `backend/app/modules/daemon/service.py`

## Phase 3 — kill / 状态机收口

- T3.1 `kill_run` 改道 `DaemonLeaseService.cancel_lease(agent_run_id)` — `backend/app/modules/agent/service.py`
- T3.2 状态映射（lease.status → AgentRun.status）单一驱动验证 — `backend/app/modules/daemon/service.py`
- T3.3 移除 SERVER 侧 `collect_diff` 调用，diff 收口 daemon — `backend/app/modules/agent/service.py`

## Phase 4 — daemon fetch 上下文

- T4.1 `_runLeaseStateMachine` claim 后新增 execution-context fetch 步骤，填充 LeaseCtx — `sillyhub-daemon/src/daemon.ts`
- T4.2 `HubClient.getExecutionContext(agentRunId)` — `sillyhub-daemon/src/hub-client.ts`
- T4.3 task-runner CLAUDE.md 写入 + 真实 clone 生效（退役 `repoUrl ?? undefined` / `branch ?? 'main'` 兜底） — `sillyhub-daemon/src/task-runner.ts`
- T4.4 `ExecutionContextPayload` 类型定义 — `sillyhub-daemon/src/types.ts`

## Phase 4.5-A — daemon 能力对齐 SERVER

- T4A.1 验证实时流等价（A1，`agent_run:{id}` channel 一致性测试） — `sillyhub-daemon/src/__tests__/daemon-parity.test.ts`
- T4A.2 stats 透传 complete_lease + `usage` 拆 `input_tokens/output_tokens` 并跨 message 累加（A2，对齐 `_extract_result_metadata`） — `sillyhub-daemon/src/task-runner.ts` + `adapters/stream-json.ts` + `daemon.ts`
- T4A.3 conversation log 汇总（A3，条件性，plan 核实前端依赖后定范围） — `sillyhub-daemon/src/task-runner.ts` + `backend/app/modules/daemon/service.py`
- T4A.4 `collectDiff` 50KB 截断 + `stat_summary` 生成（A4） — `sillyhub-daemon/src/workspace.ts`
- T4A.5 `complete_lease` diff 入库前 `redact_output` 二次脱敏（A4，redact 单一真相源留后端） — `backend/app/modules/daemon/service.py`

## Phase 4.5-B — daemon 增强（P1 本变更必做 / P2 plan 阶段定）

- T4B.1 token + `tool_config.env` 注入 claude 子进程 env（B1，P1） — `sillyhub-daemon/src/spawn-env.ts` + `task-runner.ts`
- T4B.2 超时从 `lease.metadata.timeout_seconds` / daemon config 读（B2，P1） — `sillyhub-daemon/src/task-runner.ts` + `backend/app/modules/agent/placement.py`
- T4B.3 spawn 级失败自动重试 N 次（B3，P1） — `sillyhub-daemon/src/task-runner.ts`
- T4B.4 workspace 缓存 base repo + worktree（B4，P2，可拆独立 change） — `sillyhub-daemon/src/workspace-cache.ts`
- T4B.5 stderr 独立日志文件 `${logDir}/{leaseId}.stderr`（B5，P2） — `sillyhub-daemon/src/task-runner.ts`
- T4B.6 heartbeat 间隔执行中/空闲分档（B6，P2） — `sillyhub-daemon/src/daemon.ts`
- T4B.7 资源限制（内存上限）（B7，P2） — `sillyhub-daemon/src/task-runner.ts`
- T4B.8 submitMessages 微批（B8，P2） — `sillyhub-daemon/src/task-runner.ts`

## Phase 5 — 测试与清理

- T5.1 后端 execution-context 端点 + NoOnlineDaemon + 状态映射测试 — `backend/app/modules/agent/tests/test_execution_context.py`
- T5.2 daemon execution-context fetch + CLAUDE.md 写入 + 真实 clone 测试 — `sillyhub-daemon/src/__tests__/execution-context.test.ts`
- T5.3 daemon 能力对齐测试（A1-A4：实时流 channel / metadata 写回 / diff 截断+redact） — `sillyhub-daemon/src/__tests__/daemon-parity.test.ts`
- T5.4 daemon 增强测试（B1 token 注入 / B2 超时 / B3 重试） — `sillyhub-daemon/src/__tests__/daemon-enhancements.test.ts`
- T5.5 清理孤儿变更 `unified-agent-execution`（DB id=264，scan 阶段空存根） — DB
- T5.6 全量回归：backend pytest + daemon jest — 项目根
