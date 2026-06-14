---
author: qinyi
created_at: 2026-06-14T17:25:44
change: 2026-06-14-unified-agent-execution
stage: propose
---

# Requirements — 统一 Agent 执行路径（Daemon-Only）

## 角色

| 角色 | 说明 |
|---|---|
| 用户 | 触发 agent run（brainstorm / plan / execute / verify 阶段调度，或手动 run） |
| 后端（SillyHub backend） | run 创建、bundle 构建（`render_bundle_to_claude_md`）、dispatch、execution-context 端点、lease 管理、状态映射 |
| daemon（sillyhub-daemon） | 唯一执行者：claim lease → fetch 上下文 → spawn claude → 回报 messages / complete |
| claude CLI | 实际执行的子进程（stream-json NDJSON 协议） |
| 前端 | 订阅 `agent_run:{id}` Redis channel 展示实时流 + run 详情 |

## 功能需求（FR）

### FR-01 删除 SERVER 执行路径
- **Given** 后端存在 `ClaudeCodeAdapter.run_with_bundle` / `_execute_run_background` / `_execute_stage_run` / `_execute_scan_run` 等 SERVER 实现
- **When** 移除这些代码（保留 `AgentAdapter` 抽象基类于 `base.py` 作为扩展点）
- **Then** `grep` 确认 backend 无 `_build_claude_command` / `_exec_stream` / `_execute_*_background` / `_proc_registry`

### FR-02 无在线 daemon 时明确报错（不静默 fallback）
- **Given** `decide_backend` 检测无在线 daemon
- **When** 用户触发 agent run
- **Then** `AgentRun` → `status=failed` + `error_code=no_online_daemon` + 消息「未检测到在线 daemon，请启动 sillyhub-daemon 后重试」；不静默走 SERVER

### FR-03 execution-context 端点
- **Given** daemon claim lease 后需完整上下文
- **When** `GET /agent-runs/{run_id}/execution-context`（经鉴权 + run 归属当前 user 校验）
- **Then** 返回 `{agent_run_id, claude_md, prompt, provider, resume_session_id, repo_url, branch, allowed_paths, tool_config, session_id}`

### FR-04 dispatch 透传 bundle 字段
- **Given** `dispatch_to_daemon`（`placement.py:124`）签名扩展
- **When** 调用方传入 `repo_url / branch / allowed_paths / tool_config / timeout_seconds`
- **Then** 写入 `lease.metadata`（CLAUDE.md 不入 metadata，避免 JSON 列膨胀，由端点按需 fetch）；`_build_claim_payload` 透传这些字段

### FR-05 daemon fetch 上下文（Phase 4）
- **Given** daemon `_runLeaseStateMachine` claim 成功
- **When** execute 步骤前
- **Then** `GET execution-context` 填充 `LeaseCtx.claudeMd/repoUrl/branch/allowedPaths/toolConfig`（当前 `daemon.ts:629-649` 恒 undefined 的字段补全）；CLAUDE.md 写入 `${workDir}/.claude/CLAUDE.md`；真实 clone 生效（退役 `repoUrl ?? undefined` / `branch ?? 'main'` 兜底）

### FR-06 kill 经 lease cancel
- **Given** 用户 kill 运行中的 AgentRun
- **When** `kill_run` 被调用
- **Then** 查 `agent_run_id` 对应活跃 lease → `DaemonLeaseService.cancel_lease` → daemon 经 WS/poll 感知 → task-runner SIGTERM 子进程；无 `_proc_registry` / SIGTERM→SIGKILL 链

### FR-07 状态映射单一化
- **Given** lease.status 演进
- **When** daemon 侧 `sync_agent_run_status` 驱动
- **Then** `claimed(start 后)→running` / `completed→completed` / `expired→failed` / `cancelled→killed`（单一驱动，无事后对账漂移）

### FR-08 daemon metadata 写回（A2 对齐 SERVER）
- **Given** claude result 消息含 `total_cost_usd / usage / num_turns / duration_ms`
- **When** daemon `complete_lease`
- **Then** `AgentRun.total_cost_usd / duration_ms / num_turns / input_tokens / output_tokens / session_id / exit_code` 非空且对齐；`usage` 拆 `input_tokens/output_tokens` 并跨 message 累加（对齐 SERVER `_extract_result_metadata`，`stream-json.ts:495` 当前只原样存 usage）

### FR-09 daemon diff 截断 + redact（A4 对齐 SERVER，真实缺口）
- **Given** daemon `collectDiff`（`workspace.ts:156`）收集 git diff
- **When** 上报 `complete_lease`
- **Then** `patch` 经 **50KB 截断** + 生成 **stat_summary**；后端 `complete_lease` 入库前 `redact_output` 二次脱敏（单一真相源）；含密钥 diff 不泄漏、大 diff 不撑爆存储

### FR-10 conversation log（A3，条件性）
- **Given** 前端依赖 SERVER 的汇总 conversation log 文本（`_format_conversation_log`，`claude_code.py:306`）——**plan 阶段核实前端 `agent_run:{id}` 消费 + output_redacted 渲染路径**
- **When** daemon `complete_lease`
- **Then** `output_redacted` 含按 turn 分段 + cost_info 的汇总文本
- **注**：若前端基于 `AgentRunLog` 结构化行重建，则本 FR 降级为「保持逐行 AgentRunLog 形态」并记录决策

### FR-11 token 注入 claude 子进程（B1，解「凭据分散」痛点）
- **Given** daemon 持有 `credentials.json` token + `tool_config.env`
- **When** spawn claude 子进程
- **Then** 子进程 env 含 `ANTHROPIC_API_KEY` / OAuth token；token **不入日志、不入 Redis publish payload、不回传前端**；env dump 经 redact

### FR-12 超时可配置（B2）
- **Given** `lease.metadata.timeout_seconds` 或 daemon config
- **When** 看门狗计时（当前 `task-runner.ts:390` 硬编码 setTimeout）
- **Then** 用配置值（优先级 `lease.metadata` > config > 默认），回退默认；超时触发 SIGTERM

### FR-13 spawn 级失败重试（B3）
- **Given** claude 子进程 spawn 级失败（非零退出 / 超时，且非用户 cancel、非业务 `is_error`）
- **When** daemon 检测到
- **Then** 自动重试 N 次（默认 1）；重试前清 workspace 残留、不传 `resume_session_id`（避免重复 side-effect）；重试次数记 metadata；仍失败才标 `failed`

### FR-14（P2 增强，plan 阶段定范围）
- B4 workspace 缓存（base + worktree）、B5 stderr 独立日志、B6 heartbeat 执行中/空闲分档、B7 资源限制（内存上限）、B8 submitMessages 微批——见 design §Phase 4.5-B。

## 非功能需求

- **兼容性**：破坏性切换（用户授权「未上线、数据可清空、无需兼容」）；不保留 SERVER 路径代码、不做特性开关；`preferred_backend="server"` 传参收 422 / 忽略（具体 plan 定）。
- **可回退**：唯一回退是错误路径——无在线 daemon → `AgentRun.failed` + 明确错误码，引导用户启动 daemon 后重试。
- **可测试**：每 FR 对应测试（端点 / NoOnlineDaemon / 状态映射 / diff 截断+redact / metadata 写回 / token 注入 / 重试），见 tasks.md Phase 5。
- **可扩展**：`AgentAdapter` 抽象基类保留于 `base.py`；改 claude 契约只改 daemon 一处；改上下文只改后端一处（`context_builder` 单一真相源）。
- **安全**：execution-context 端点鉴权 + run 归属校验；diff / output / env 经 redact；token 不泄漏（R-09）。
- **数据模型**：无 schema 变更。`AgentRun` 已有全部 cost/timing 字段（`model.py:85-187`：`exit_code/total_cost_usd/duration_ms/num_turns/session_id/input_tokens/output_tokens`），A2 写回链路后端就绪；新增字段仅写入既有 `DaemonTaskLease.metadata`（JSON 列），无迁移。
