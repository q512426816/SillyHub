---
author: qinyi
created_at: 2026-05-30 20:20:00
---

# agent

> 最后更新：2026-06-14
> 最近变更：2026-06-14-agent-runtime-selection（placement provider 严格匹配 + 跨 provider 回退告警；三入口 provider 解析）
> 模块路径：`app/modules/agent/**`

## 职责

管理 AI Agent（Claude Code）的运行生命周期。**2026-06-14 起 daemon 是唯一执行者**（SERVER 路径已删，task-01）：本模块负责调度（`dispatch_to_daemon` 创建 `daemon_task_leases` 行）+ 上下文构建（`build_spec_bundle` / `render_bundle_to_claude_md`）+ execution-context 端点透传 bundle + kill/状态机收口（`cancel_lease` + lease.status→AgentRun.status 单一驱动）+ 执行可靠性保证（`ExecutionCoordinatorService`）+ Usage/Cost/diff 回写。claude 子进程的 spawn/parse 由 sillyhub-daemon 子项目执行（见 `docs/sillyhub-daemon/`）。

## 当前设计

### 架构（daemon-only）

```
AgentService（编排层）
  ├── RunPlacementService（后端选择）— decide_backend 恒返回 DAEMON，无在线 daemon 抛 NoOnlineDaemonError
  ├── ContextBuilder（上下文构建）— build_spec_bundle / build_stage_bundle / build_scan_bundle + render_bundle_to_claude_md
  ├── ExecutionCoordinatorService（协调器）— 执行可靠性保证（6 能力点）
  └── dispatch_to_daemon（调度）— 创建 daemon_task_leases + bundle 字段持久化到 lease.metadata
       ↓ HTTP/WS
  daemon（sillyhub-daemon 子项目）— claim → fetch execution-context → spawn claude → submit_messages/complete_lease 回报
       ↓ complete_lease
  daemon 模块（backend/app/modules/daemon）— 写回 AgentRun cost/timing/tokens + diff redact_output + 状态映射 sync
```

### 关键逻辑

1. **后端选择**：`decide_backend` 恒返回 `ExecutionBackend.DAEMON`；`preferred_backend="server"` 被拒绝（抛 `placement_unknown_preferred_backend`）。无在线 daemon → 抛 `NoOnlineDaemonError` → `start_run`/`start_stage_dispatch` 捕获 → `_mark_no_online_daemon` 设置 `AgentRun.status=failed` + `error_code=no_online_daemon` + 用户可读消息「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」。
2. **dispatch 与上下文持久化**（task-03）：`dispatch_to_daemon` 签名扩展 `repo_url/branch/allowed_paths/tool_config/timeout_seconds`；三处 dispatch（`start_run` / `start_stage_dispatch` / `start_scan_dispatch`）把 stage/scan 上下文参数（prompt/step_prompt/stage/read_only/root_path/spec_root/runtime_root）持久化到 `lease.metadata`，经 `daemon._build_claim_payload` 透传。
3. **execution-context 端点**（task-02）：`GET /agent-runs/{run_id}/execution-context` 做 run 类型分发（task/stage/scan，依据 lease.metadata + agent_type + task_id），从活跃 lease.metadata 恢复上下文，复用 `build_*_bundle` + `render_bundle_to_claude_md` 渲染。鉴权 `require_permission_any(TASK_READ)` + `_user_owns_run` 归属校验（跨 user → 403）。
4. **kill 收口**（task-04）：`kill_run` 改道 `DaemonLeaseService.cancel_lease(agent_run_id)`，标 lease→cancelled；**不直接写 `status=killed`**，由 daemon 上报后 `sync_agent_run_status` 单一驱动到 killed。无 `_proc_registry`、无 SIGTERM 链。
5. **状态映射单一驱动**（task-04）：lease.status → AgentRun.status 单一驱动（`claimed→running / completed→completed / expired→failed / cancelled→killed`），无对账漂移。
6. **diff 收口 daemon**：diff 由 daemon `collectDiff`（50KB 截断 + stat_summary）经 `complete_lease` 上报；后端 `complete_lease` 入库前 `redact_output` 二次脱敏（redact 单一真相源留后端 git_gateway）。
7. **流式日志**：通过 Redis Pub/Sub 推送 `agent_run:{id}` channel（daemon `submit_messages` / `sync_agent_run_status` / lease start/complete 均发同一 channel）。前端 SSE 端点支持 `after` 查询参数（AgentRunLog.id UUID）断线续传，事件携带 `log_id` 去重。
8. **执行可靠性保证**：`ExecutionCoordinatorService` 封装 6 能力点：幂等创建（`idempotency_key`）、乐观锁（`version`）、上下文指纹（SHA-256）、执行恢复（`resume_token` 一次性）、进度快照（`checkpoint_data` JSONB + `checkpoint_version`）、审批门（`approval_token` 一次性）。
9. **用户指导输入**：`submit_run_input()` 接受 `pending_input` 事件回复，写 `AgentRunLog(channel="user_input")` 并 Redis Pub/Sub 推送。通道约定：`pending_input`（Agent 请求确认）/ `user_input`（用户指导文本）。
10. **Usage/Cost 追踪**：由 daemon `complete_lease` 写回 AgentRun `total_cost_usd/duration_ms/input_tokens/output_tokens/num_turns/session_id/exit_code`（task-06，daemon 侧 `usage` 跨 message 累加对齐原 SERVER `_extract_result_metadata`）。
11. **Provider 解析与 placement 回退**（2026-06-14）：三入口（`start_run` / `start_stage_dispatch` / `start_scan_dispatch`）统一 `resolved_provider = provider or workspace.default_agent`（优先级：显式入参 > workspace.default_agent > None），解析后透传 `dispatch_to_daemon(provider=)`。placement 层 `_get_online_runtime(provider)` 严格匹配 provider：provider 给定且无在线 runtime → **跨 provider 回退任意在线** + `log.warning("placement_provider_fallback", wanted=provider, actual=...)`（不失败，R-01 靠告警暴露配置错误）；provider=None 维持 `ORDER BY last_heartbeat DESC`（旧行为不变，成功标准 1）。自动调度链路（`auto_dispatch_next_step`）不传 provider，由 `start_stage_dispatch` 内部读 default_agent 兜底（FR-04 / R-03）。

## 对外接口

| 接口 | 方法 | 说明 | 调用方 |
|------|------|------|--------|
| `POST /workspaces/{ws}/agent/runs` | `start_run()` | 启动 agent run（无在线 daemon → failed + no_online_daemon）；**2026-06-14 起** 接收 `AgentRunCreate.provider` 覆盖默认 agent | 前端 |
| `GET /agent-runs/{run_id}/execution-context` | `_get_execution_context()` | **task-02 新增**：透传完整 bundle（claude_md+prompt+repo/branch+allowed_paths+tool_config），run 类型分发 + 鉴权 + 归属校验 | daemon |
| `GET /workspaces/{ws}/agent/runs/{id}` | `get_run()` | 查询单个 run | 前端 |
| `GET /workspaces/{ws}/agent/runs` | `list_runs()` | 列出 workspace runs | 前端 |
| `GET /workspaces/{ws}/tasks/{tid}/agent/runs` | `list_runs(task_id=)` | 列出 task runs | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/logs` | `get_run_logs()` | 获取历史日志 | 前端 |
| `GET /workspaces/{ws}/agent/runs/{id}/stream` | `stream_run_logs()` | SSE 实时日志流（`after` 续传） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/kill` | `kill_run()` | 经 `cancel_lease` 终止（不再直写 killed） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/resume` | `resume_run()` | 恢复中断的 run（需 resume_token） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/approve` | `approve()` | 审批 pending_approval 的 run | 前端 |
| `GET/POST /workspaces/{ws}/agent/runs/{id}/checkpoint` | `load/save_checkpoint()` | checkpoint 存取（version 递增） | 前端 |
| `POST /workspaces/{ws}/agent/runs/{id}/input` | `submit_run_input()` | 提交用户指导文本（pending_input 回复） | 前端 |

## 关键数据流

```
前端 → POST /runs → AgentService.start_run()
  → ExecutionCoordinatorService.check_idempotency()
  → ContextBuilder.render_bundle_to_claude_md()
  → RunPlacementService.decide_backend() → DAEMON
       无在线 daemon → NoOnlineDaemonError → AgentRun.failed + no_online_daemon
  → dispatch_to_daemon() → INSERT daemon_task_leases(pending) + bundle 字段入 lease.metadata
  ← 返回 run_id（daemon 异步 claim 执行）

daemon → GET /agent-runs/{id}/execution-context → 取 bundle（run 类型分发）
daemon → spawn claude → submit_messages → Redis publish agent_run:{id}
daemon → complete_lease(stats + diff) → daemon 模块写回 AgentRun 字段 + redact_output
       → sync_agent_run_status: lease.completed → AgentRun.completed

前端 → POST /runs/{id}/kill → kill_run()
  → DaemonLeaseService.cancel_lease(agent_run_id) → lease.cancelled
  → daemon 上报 → sync_agent_run_status → AgentRun.killed（单一驱动，不直写）
```

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| daemon 唯一执行者，删 SERVER 路径 | 消除协议机械层重复（claude 命令构建/解析双写 Python+Node）；SERVER 在生产容器无 claude CLI 静默失败 | 2026-06-14-unified-agent-execution |
| 无在线 daemon → failed + 错误码 | 显性失败替代 SERVER 静默 fallback | 2026-06-14-unified-agent-execution |
| kill 经 cancel_lease + 状态映射单一驱动 | lease 成为 AgentRun 唯一执行载体，无对账漂移 | 2026-06-14-unified-agent-execution |
| execution-context 端点补齐上下文缺口 | daemon claim 仅拿裸 prompt → 端点透传完整 bundle（claude_md + repo/branch + allowed_paths + tool_config） | 2026-06-14-unified-agent-execution |
| `ExecutionBackend.SERVER` enum 保留但路径删除 | 防外部 import 断裂 | 2026-06-14-unified-agent-execution |
| `ExecutionCoordinatorService` 分层 | AgentService 专注调度，Coordinator 专注可靠性 | 2026-05-30-execution-coordinator |
| AgentRun 字段扩展（不建新表） | 6 能力点高度内聚；字段可 NULL 向后兼容 | 2026-05-30-execution-coordinator |
| 乐观锁用 version 字段 | 实现简单、无额外依赖 | 2026-05-30-execution-coordinator |
| pending_input/user_input 通道约定 | 结构化日志事件复用 AgentRunLog + SSE，不新增表/schema enum | 2026-06-02-spec-bootstrap-agent-stream-interaction |
| SSE 事件携带 `log_id`（UUID） | 前端 log_id Set 去重，替代 timestamp+content 拼接 | 2026-06-02-sse-reliable-stream |

## 依赖关系

### 依赖本模块
- `router.py`（HTTP API 层）
- `daemon` 模块（complete_lease 写回 + 状态映射）
- 前端 Agent 监控页面

### 本模块依赖
- `core/errors`：`AgentRunNotFound`, `AgentRunNotRunning`, `AgentRunNotKillable`（`NoOnlineDaemonError` 定义于本模块 `placement.py`，2026-06-14-unified-agent-execution 引入）
- `core/redis`：Pub/Sub 日志流（`agent_run:{id}`）
- `core/db`：SQLAlchemy session
- `git_gateway/service`：`redact_output()` 脱敏（diff 二次脱敏在 daemon 模块调用）
- `worktree/model`：`WorktreeLease` 路径解析
- `workspace/model`：workspace 关联
- `task/model`：task 关联

## 注意事项

- daemon 离线时 `start_run` / `start_stage_dispatch` / `start_scan_dispatch` 立即标 failed + `no_online_daemon`，不再静默 fallback。
- `kill_run` 不直接写 `status=killed`，依赖 daemon 上报 + `sync_agent_run_status` 驱动；daemon 离线时 lease 标 cancelled，daemon 重连后终止。
- `CLAUDE_ALLOWED_PATHS` / `tool_config` 经 dispatch 持久化到 lease.metadata，daemon 经 execution-context 恢复。
- PAT 脱敏通过 `redact_output()` 实现（diff 入库前在 daemon 模块二次脱敏）。
- Optimistic lock 冲突返回 409，客户端需获取最新 version 后重试。
- Checkpoint 只保留最新快照；`resume_token`/`approval_token` 使用后置 NULL。
- 历史 AgentRun 数据可清空（用户授权未上线、无需兼容存量状态漂移）。

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-06-14 | 2026-06-14-agent-runtime-selection | 三入口（start_run/start_stage_dispatch/start_scan_dispatch）provider 解析（显式 > workspace.default_agent > None）+ 透传 dispatch_to_daemon(provider=)；placement `_get_online_runtime(provider)` 严格匹配 + 跨 provider 回退告警（placement_provider_fallback）；AgentRunCreate.provider 字段 + create_agent_run 透传 |
| 2026-06-14 | 2026-06-14-unified-agent-execution | 删 SERVER 路径（claude_code.py 整文件 + 三条执行体 + _proc_registry + SIGTERM 链）；daemon 唯一执行者 + NoOnlineDaemonError；新增 execution-context 端点；dispatch_to_daemon 扩字段 + lease.metadata 持久化；kill 改 cancel_lease + 状态映射单一驱动；diff 收口 daemon |
| 2026-06-05 | ql-20260605-003-c8e4 | AgentRun 新增 6 列（cost/timing/num_turns/session_id/conversation_events），适配器解析 CLI result 元数据 |
| 2026-06-02 | 2026-06-02-sse-reliable-stream | SSE `after` 续传 + `log_id` 去重 |
| 2026-06-02 | 2026-06-02-spec-bootstrap-agent-stream-interaction | `submit_run_input()` + `pending_input`/`user_input` 通道 |
| 2026-05-31 | 2026-05-30-execution-coordinator | ExecutionCoordinatorService + AgentRun 9 字段 + 4 新端点 + 25 测试 |
| 2026-05-30 | 2026-05-30-agent-adapter | Kill API + Diff Collector + 进程注册表（**已于 2026-06-14 随 SERVER 路径移除**） |
