---
author: qinyi
created_at: 2026-08-06 13:04:20
scale: large
---

# 设计文档（Design）— 对外暴露生产级 MCP 给第三方

## 1. 背景

平台已有一套内部多 agent 编排能力：`backend/app/modules/agent/mcp_tools.py` 提供 5 个 HTTP 端点（dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress），`sillyhub-daemon/src/mcp-server.ts` 把它们包成一个 **stdio MCP server**，由 daemon 启动主 agent（claude/codex）时经 `--mcp-config` 注入。也就是说，目前只有**平台内部的主 agent**能用这套 MCP 工具去派 worker。

但这两层都对"外部第三方编排者"不友好：

- **transport 限制**：现有 MCP server 是纯 stdio（`mcp-server.ts:35,348` 的 `StdioServerTransport`），第三方（远程的、别人机器上的 Claude Code/Desktop/Cursor）连不上。
- **鉴权无对外口径**：现有 `get_current_principal`（`auth_deps.py:150-168`）虽支持 JWT + X-API-Key 双路径，但 X-API-Key 是 admin 签发的 **user 级**长期 key，继承该 user 全部 workspace 权限，给第三方风险面太大，且无 scope / 不可独立吊销。
- **4 项能力 gap**（前两轮只读调研 + 本设计 step5 亲自复核行号确认）：
  - dispatch 派 worker **绑不了 AgentProfile**（`mcp_tools.py:55-66` `DispatchWorkerRequest` 无 `agent_profile_id`，第三方"选了 agent 传不下去"）。
  - `read_only` 只是 prompt 建议（`mcp_tools.py:359` 传给 execution，无物理拦截）。
  - 完成无主动通知，第三方只能轮询 `list_workers`。
  - 5 个 MCP 工具里没有 `list_agent_profiles` / `create_mission` / `get_run_logs`，外部编排者要"列 agent/建 mission/看完整日志"得绕回 HTTP，纯 MCP 闭环不了。

目标：把这套能力升级为**对外暴露的生产级 MCP 服务**，第三方配置一个 URL + token 即可接入，整个外部编排链路（连接 → 选 agent → 派活 → 看记录 → 拿回馈）闭环，配套生产级文档。

### 1.1 关键纠正：D-017 不冲突

前期（前两轮调研）误判「平台防 SSRF D-017 禁了远程 transport」。真身见 `docs/arch-analysis-daemon-agent-workspace-2026-08-02.md:328`：

> 权限边界：mcp_servers 只允许 stdio 类型（command + args），不允许 HTTP/SSE 类型（防 SSRF）

这条限制管的是**平台 agent 作为 MCP 客户端**去连外部 MCP server（防 agent 被 SSRF 攻击），方向与本变更「平台作为 MCP **server** 被外部连」**完全相反**。本变更不受 D-017 约束。风险登记 R-07 要求 Design Grill 复核确认。

### 1.2 关键复用点（降低工作量）

- `AgentRun.agent_profile_id` + `agent_profile_snapshot` 字段**已存在**（`model.py:133-145`，2026-08-02-agent-profile-layer 加）——绑 profile **不改表**，只补 dispatch 入参。
- read_only 物制：daemon 侧 `stream-json.ts:333-337` 已实现把 `toolConfig.allowed_tools` push 成 claude `--allowedTools`（worker 工具治理），`worker_tool_config(read_only)`（`execution.py:75`）已返回 `{mode:'plan',allowed_tools:['Read','Glob','Grep'],max_turns:25}`——read_only 物制**走 daemon SDK 权限单腿**（详见 §5.2 P3 + R-02/R-09）。
- ⚠️ Design Grill CC-02 修正：原设想"backend `tool_gateway` `ToolPolicy` 作为 read_only 双保险之一"**不成立**——`ToolPolicyService.check` 唯一入口是 `POST /workspaces/{lease_id}/tools`（`tool_gateway/service.py:156`），claude worker 由 daemon 本地 spawn、Read/Write/Edit/Bash 在宿主执行**从不调该端点**；`AgentRun.tool_policy_id`（`model.py:187`）是孤儿列（execution/placement/daemon 全无加载，arch doc:313 自认"未充分使用"）。`ToolPolicy` 是 tool_gateway HTTP 端点的独立能力，与 claude worker 正交，本变更不动它。
- `create_mission`（`router.py:847`）mode=team 已走 `OrchestratorService.team_mission_entry`——MCP `create_mission` 工具直接复用。
- 现有 SSE：`agent/router.py` 的 `stream_agent_run_logs` 是成熟 SSE 端点——mission 级 SSE 复用其模式。
- `ApiKeyService`（`auth_deps.py:168`）带 Redis 缓存——McpToken 校验复用其缓存模式。

## 2. 设计目标

- **G1**：第三方经 streamable HTTP + McpToken 连上平台 MCP，纯 MCP 闭环（不混 HTTP）完成：选 agent → 建 mission → 派 worker → 看日志/产出 → 收敛 → 拿完成回馈。
- **G2**：McpToken 绑定 workspace + scope（read/dispatch/converge），可独立吊销，最小权限。
- **G3**：read_only worker 物理强制（daemon SDK `--allowedTools` 单腿，详见 §5.2 P3），落 run 记录可审计。
- **G4**：dispatch 可绑 AgentProfile，第三方能精确"选 agent"。
- **G5**：worker 终态主动通知（webhook）+ 实时进度（mission SSE），免轮询。
- **G6**：生产级 MCP 文档（接入指南 + 工具清单 + 鉴权 + 通知 + 错误码 + 安全）。
- **G7**：复用现有 service 层 / 基础设施，不重写业务逻辑，内部主 agent 的 stdio MCP server 保留不动。

## 3. 非目标（Non-Goals）

- **NG-1**：一次性专家入口（免 mission、免闲置主 agent 的纯一次性派活）。本次复用 team mission 模式（忍一个闲置主 agent run），留后续独立 change（D-004）。
- **NG-2**：OAuth2 / 开放生态多租户注册。鉴权用平台签发的 McpToken，不做第三方自主注册。
- **NG-3**：改造内部 stdio MCP server（给主 agent 用）。它保留原样，本变更新增独立的对外远程端点。
- **NG-4**：前端管理界面（McpToken/webhook 的 CRUD UI）。本期提供 HTTP 管理接口即可，前端 UI 留后续。
- **NG-5**：mission 模型重构。AgentRun/AgentMission 表结构基本不动（仅 AgentRun 加 read_only 列）。

## 4. 拆分判断

**不拆分，作为单一 change + Wave 分组**。理由：7 个 Phase 逻辑上是一个整体功能（对外 MCP 服务），Phase 之间耦合（mcp_gateway tool handler 依赖 McpToken 鉴权；read_only/绑 profile 依赖 dispatch；webhook 依赖 worker 终态钩子）。拆成多个 change 会割裂依赖、增加跨 change 协调成本。用 Wave 串行化解内部依赖，Wave 内任务并行。

**不走批量模式**：8 个 MCP tool 虽然有相似模式（都是 workspace 前缀 + service 调用），但每个 tool 的 input/output/service 逻辑各异，不是"模板 × 数据"，逐个实现更清晰。

## 5. 总体方案

### 5.1 架构

```
第三方编排者(Claude Code / Desktop / Cursor / 任意 MCP 客户端)
   │ ① streamable HTTP + Authorization: Bearer <McpToken>
   ▼
┌──────────────────────────────────────────────────────────┐
│ backend FastAPI                                           │
│                                                           │
│  /mcp ── FastMCP mount (官方 mcp Python SDK, http_app ASGI) │
│   │   Starlette middleware: 校验 McpToken → 注入          │
│   │   (workspace_id, scope) 到 tool 上下文                 │
│   │   8 个 tool handler (按 scope 拒绝越界):               │
│   │     现有5: dispatch_worker / get_worker_result /       │
│   │            list_workers / converge_mission /          │
│   │            report_progress                            │
   │     新增3: list_agent_profiles / create_mission /       │
│   │            get_run_logs                               │
│   ▼   复用 service 层(业务逻辑零重复)                       │
│  MissionExecutionService / OrchestratorService /          │
│  AgentProfileService / tool_gateway                       │
│                                                           │
│  通知: webhook 投递器(终态钩子) + mission SSE 流            │
└──────────────────────────────────────────────────────────┘
   │ dispatch → daemon lease (现有链路不变)
   ▼
sillyhub-daemon → Claude worker
   read_only 物制 = daemon SDK --allowedTools 只读（单腿，ToolPolicy 正交不动）
```

### 5.2 Phase 拆分

#### Phase 1 · 对外 MCP 远程端点（D-001 / D-007）
新增 `backend/app/modules/mcp_gateway/`。`pyproject.toml` 加 `mcp` 官方 Python SDK 依赖（锁版本）。用 `FastMCP` 定义 8 个 tool，`mcp.http_app()` 返回 ASGI app → `app.mount("/mcp", ...)`。transport = streamable HTTP（2025 官方推荐，取代老 SSE，第三方标准 MCP 客户端即插即用）。tool handler 直接调现有 service 层，业务行为与内部 `mcp_tools.py` endpoint 一致。

#### Phase 2 · McpToken 鉴权与隔离（D-002）
新表 `mcp_tokens`（见 §8）。scope 为集合（`read` / `dispatch` / `converge`）。Starlette middleware 解析 `Authorization: Bearer <token>` → 查 `mcp_tokens`（token_hash 匹配 + 未吊销）→ 注入 `workspace_id` + `scope` 到 tool 上下文。tool handler 入口按 scope 校验（如 `converge_mission` 要求 `converge` scope，否则 403）。校验复用 `ApiKeyService` 的 Redis 缓存模式（命中缓存避免每请求查库）。签发/列出/吊销走独立 HTTP 管理 API（§7.2）。

#### Phase 3 · read_only 物理强制（D-005@v2 修订，Design Grill CC-02/CC-03）

**Phase 3 第一步 = 端到端实测厘清现状**（CC-03 发现矛盾）：
- daemon `stream-json.ts:333-337` 已实现把 `toolConfig.allowed_tools` → `--allowedTools`、`max_turns` → `--max-turns`（注释 :313 明写 governs Worker execution）；
- 但 `execution.py:14-23` docstring 明写"v1 工具治理 = 不强制，daemon does NOT apply it"；
- 且 `tool_config` 在 daemon 侧有**二义性**（CC-10/R-09）：stream-json 当结构体 `{mode,allowed_tools,max_turns}`（buildArgs 用），spawn-env/types.ts:186 当 `Record<string,string>` 凭据 env——backend 写结构体进 `metadata['tool_config']` 后是否正确流到 buildArgs 未验证。
- **故 Phase 3 首步派一个 read_only worker 端到端实测**是否真被限成 Read/Glob/Grep，据实测结果定范围 + 修 `execution.py` docstring。

物制方案（实测确认传递链通后）：
- **daemon SDK `--allowedTools` 单腿物制**（read_only worker 限定 Read/Glob/Grep，SDK 原生拒绝写工具）——这是 claude worker 唯一真实物制腿（CC-02 证实 backend `ToolPolicy` 对 claude worker 永不触发，已从设计删除）。
- `read_only` 落 `AgentRun` 新列（`agent_runs.read_only`，nullable bool，兼容老行）供前端/审计查询。
- backend `tool_gateway` `ToolPolicy` 是独立能力（管 HTTP 端点 `/workspaces/{lease_id}/tools` 的调用），**与 claude worker 物制无关**，本变更不动它。

#### Phase 4 · dispatch 绑 profile（gap）
`DispatchWorkerRequest`（`mcp_tools.py:55`）加 `agent_profile_id: uuid.UUID | None`。`dispatch_worker` 里：校验 profile 属该 workspace → `run.agent_profile_id = payload.agent_profile_id` → 冻结 `agent_profile_snapshot`（复用 `model.py:133-145` 已有字段，**不改表**）。MCP `dispatch_worker` tool 暴露该入参。

#### Phase 5 · 完成通知（D-003）
- **webhook**：新表 `mcp_webhooks`（见 §8）。投递器挂在 worker 终态钩子（`complete_lease` 处 worker run 进入 completed/failed/killed 时触发）：`httpx.AsyncClient` POST `{event, workspace_id, mission_id, worker_id, status, ...}` + `X-Signature: <HMAC-SHA256(secret, body)>`，指数退避重试（最多 N 次），投递结果落 `mcp_webhook_deliveries` 审计表（可选）。
- **mission SSE**：复用 `stream_agent_run_logs`（`agent/router.py`）模式，新增 `GET /api/workspaces/{wid}/missions/{mid}/events` → `text/event-stream`，推 worker 状态变更事件。第三方可选订阅实时进度（SSE）或等终态（webhook）。

#### Phase 6 · MCP 工具补全（D-006）
- `list_agent_profiles`：复用 `profile/router.py` 清单逻辑，返回 `{id, name, description, provider, model, tools_summary}`（第三方据此选 agent）。
- `create_mission`：复用 `OrchestratorService.team_mission_entry`（mode=team，D-004 忍一个闲置主 agent run）或暴露轻量"仅建 mission 不 dispatch"模式。
- `get_run_logs`：查 `AgentRunLog` by `run_id`（`model.py:336`），返回 `{timestamp, channel, tool_kind, content_redacted}`（对齐 `AgentRunLog.content_redacted` `:391`），补齐"看完整执行过程"，不再混 HTTP。

#### Phase 7 · 生产级 MCP 文档
`docs/mcp/` 目录：
- `README.md`：总览 + 快速开始。
- `getting-started.md`：URL 配置 + McpToken 签发 + Claude Desktop / Code / Cursor 配置示例（含 `.mcp.json` / `claude_desktop_config.json` 片段）。
- `tools-reference.md`：8 个 tool 的 input/output schema + 调用示例 + 错误码。
- `webhooks.md`：webhook 注册 + payload 格式 + HMAC 签名校验 + 重试策略。
- `sse.md`：mission SSE 订阅 + 事件类型。
- `security.md`：scope 模型 + token 吊销 + 本地开发隧道方案（ngrok / cloudflare tunnel）+ 安全注意事项。

### 5.3 Wave 分组（plan 阶段细化）

| Wave | Phase | 内容 | 依赖 |
|---|---|---|---|
| W1 | P2 | mcp_tokens 表 + alembic 迁移 + McpToken service + 签发/校验/吊销 + middleware | 无（地基） |
| W2 | P1 | mcp SDK 依赖 + mcp_gateway 模块 + FastMCP mount + 8 tool handler 接 service 层 | W1（鉴权） |
| W3 | P3+P4 | read_only 物制（SDK --allowedTools 实测厘清 + AgentRun.read_only 列）+ dispatch 绑 profile | W2 |
| W4 | P5 | mcp_webhooks 表 + webhook 投递器 + mission SSE 端点 | W2 |
| W5 | P6+P7 | 3 个新工具完善 + docs/mcp/ 全套文档 | W2-W4 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `backend/app/modules/mcp_gateway/__init__.py` | 模块初始化 |
| 新增 | `backend/app/modules/mcp_gateway/server.py` | FastMCP 实例 + 8 tool 定义 + http_app mount |
| 新增 | `backend/app/modules/mcp_gateway/auth.py` | McpToken middleware（校验 + 注入 workspace/scope） |
| 新增 | `backend/app/modules/mcp_gateway/tools.py` | 8 tool handler（调 service 层 + scope 校验） |
| 新增 | `backend/app/modules/mcp_gateway/model.py` | McpToken / McpWebhook ORM 模型 |
| 新增 | `backend/app/modules/mcp_gateway/service.py` | token 签发/校验/吊销（含 Redis 缓存）+ webhook 投递 |
| 新增 | `backend/app/modules/mcp_gateway/router.py` | HTTP 管理 API（token/webhook CRUD） |
| 新增 | `backend/app/modules/mcp_gateway/sse.py` | mission 级 SSE 端点 |
| 修改 | `backend/app/main.py` | `include_router(mcp_router)` + `app.mount("/mcp", mcp_asgi)` |
| 修改 | `backend/pyproject.toml` | 加 `mcp>=<version>` 依赖 |
| 修改 | `backend/app/modules/agent/mcp_tools.py` | `DispatchWorkerRequest` 加 `agent_profile_id`；dispatch_worker 绑 profile + 冻结 snapshot；read_only 落 run.read_only |
| 修改 | `backend/app/modules/agent/model.py` | `AgentRun` 加 `read_only` 列 |
| 修改 | `backend/app/modules/agent/execution.py` | 修 :14-23 docstring（厘清 read_only 物制现状）+ 确认 `worker_tool_config` 传递链 |
| 修改 | `backend/app/modules/daemon/lease/service.py` | `DaemonService.complete_lease` 加 webhook 终态钩子（CC-08：钩子在 service 层非 router） |
| 修改 | `sillyhub-daemon/src/adapters/stream-json.ts` + lease 传递链 | 实测 `--allowedTools` 端到端；若传递链断则补通 / 拆 `tool_config` 二义 key（CC-03/R-09） |
| 新增 | `backend/migrations/versions/20260806140000_add_mcp_tokens_webhooks_run_readonly.py` | alembic：建 mcp_tokens + mcp_webhooks + agent_runs.read_only 列 |
| 新增 | `backend/app/modules/mcp_gateway/tests/test_*.py` | token 鉴权 / scope 拒绝 / tool handler / webhook 投递 / SSE 测试 |
| 新增 | `backend/app/modules/mcp_gateway/tests/__init__.py` | 测试包初始化（test_*.py glob 不含） |
| 新增 | `backend/app/modules/agent/tests/test_dispatch_profile.py` | FR-04 dispatch_worker 绑 AgentProfile + 冻结 snapshot 测试 |
| 修改 | `backend/app/modules/daemon/tests/test_lease_service.py` | CC-08 complete_lease webhook 终态钩子容错测试（钩子容错不破坏既有 lease 终态断言） |
| 修改 | `backend/uv.lock` | mcp 官方 SDK + aiobotocore 等依赖锁定（pyproject.toml 加 mcp 联动） |
| 新增 | `spikes/mcp-fastmcp-mount-spike.py` | task-04/CC-07 FastMCP mount + 鉴权注入 spike 验证（R-01/R-04，PASS） |
| 新增 | `spikes/read_only-allowedtools-spike.md` | task-07/CC-03 read_only `--allowedTools` 传递链 spike 记录（R-02/R-09，PASS） |
| 新增 | `docs/mcp/*.md` | 7 篇生产级文档 |
| 修改 | `frontend/src/lib/api-types.ts` + `backend/openapi.json` | 管理接口 DTO 同步（pnpm gen:types） |

> 📌 verify 阶段（2026-08-07）apply Gate1 补登：execute 落地了上表迁移真实文件名（替代 plan 期占位符 `2026xxxxxxxx`）、mcp_gateway 测试包 `__init__.py`、跨模块测试（agent `test_dispatch_profile.py` / daemon `test_lease_service.py`）、`uv.lock`、两份 spike 证据（`spikes/`），但未回写 §6 清单，致 `sillyspec worktree apply` manifest 校验失败。此处补全为 manifest 账目订正，非设计决策变更（不触发 §8.2 类 brainstorm --reopen）。

> ⚠️ 自审存疑（Design Grill 后更新）：CC-03 `--allowedTools` 端到端传递链（stream-json.ts 已消费，但 backend→daemon metadata 传递 + execution.py docstring 矛盾 + tool_config 二义）须 Phase 3 实测厘清；CC-05 McpToken 无 user，`create_mission` 的 `created_by` 用 `token.created_by` 还是 None 待 plan 定。

## 7. 接口定义

### 7.1 MCP 工具（8 个，mount 在 /mcp，streamable HTTP）

所有 tool 第一个参数 `workspace_id` 由 middleware 从 McpToken 注入（客户端不必传，或传了必须与 token 绑定一致）。

| Tool | 输入 | 输出 | scope |
|---|---|---|---|
| `list_agent_profiles` | workspace_id | `[{id, name, description, provider, model, tools_summary}]` | read |
| `create_mission` | workspace_id, objective, mode?=team, worker_preset?, main_agent_config?, budget_usd?, change_id? | `{mission_id, status, main_run_id?, workers[]}` | dispatch |
| `dispatch_worker` | workspace_id, mission_id, objective, role?, agent_type?, model?, read_only?, **agent_profile_id?** | `{worker_run_id, status, lease_id, error_code}` | dispatch |
| `list_workers` | workspace_id, mission_id | `{workers:[{id, role, status, objective, total_cost_usd}]}` | read |
| `get_worker_result` | workspace_id, mission_id, worker_id | `{worker_id, status, artifacts[], cost?}` | read |
| `get_run_logs` | workspace_id, mission_id, worker_id, limit?=100, channel? | `{logs:[{timestamp, channel, tool_kind, content_redacted}]}` | read |
| `converge_mission` | workspace_id, mission_id | `{mission_id, status, converged, conflicts?, attempt}` | converge |
| `report_progress` | workspace_id, mission_id, run_id, message, decision? | `{run_id, log_id}` | dispatch |

### 7.2 McpToken / Webhook HTTP 管理 API（非 MCP，workspace owner/admin 用）

- `POST /api/workspaces/{wid}/mcp-tokens` → 签发，body `{name, scope[]}`，返回 `{id, token(明文,仅此一次), scope, created_at}`。
- `GET /api/workspaces/{wid}/mcp-tokens` → 列出（不返明文，含 last_used_at / revoked_at）。
- `DELETE /api/workspaces/{wid}/mcp-tokens/{id}` → 吊销（revoked_at）。
- `POST /api/workspaces/{wid}/mcp-webhooks` → 注册，body `{url, secret, events[]}`。
- `GET /api/workspaces/{wid}/mcp-webhooks` / `DELETE /api/workspaces/{wid}/mcp-webhooks/{id}`。

### 7.3 webhook 投递 payload

```
POST <第三方 url>
Headers: X-Signature: hmac_sha256(webhook.secret, body, hex)
Body: {event, workspace_id, mission_id, worker_id, status, error_code?, timestamp}
```
重试：指数退避（1s/4s/16s/64s），最多 5 次，失败落审计。

## 7.5 生命周期契约表

本变更涉及 agent_run / mission / lease / daemon 关键词，按下表定义事件链路：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| MCP tool call | 第三方 MCP 客户端 | backend FastMCP | `Authorization: Bearer <McpToken>`, workspace_id, tool, params | — |
| create_mission | 第三方 | backend (OrchestratorService) | workspace_id, objective, mode | mission created; main_run pending |
| dispatch_worker | 第三方 | backend (MissionExecutionService) | mission_id, objective, agent_profile_id?, read_only? | worker_run pending → lease created |
| claim lease | daemon | backend | leaseId, claimToken, agentRunId | worker_run pending → running |
| worker terminal | daemon | backend (complete_lease) | runId, status(completed/failed/killed), output | running → 终态；read_only 落 run.read_only |
| webhook notify | backend | 第三方 | event, workspace_id, mission_id, worker_id, status, X-Signature | — |
| SSE event | backend | 第三方 | event_type, payload | — |

每个事件均有对应代码任务（§6 文件清单）+ 测试任务（plan 阶段补）。webhook notify / SSE event 是**新增事件**（外部编排者才有），内部主 agent 链路不受影响。

## 8. 数据模型

### 8.1 新表 `mcp_tokens`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| workspace_id | UUID FK→workspaces CASCADE | 绑定 workspace |
| name | String(100) | 人类可读标签 |
| token_hash | String(128) UNIQUE | 存 sha256(明文)，不存明文 |
| scope | JSON | `["read","dispatch","converge"]` |
| created_by | UUID FK→users SET NULL | |
| created_at | DateTime | |
| last_used_at | DateTime nullable | 审计 |
| revoked_at | DateTime nullable | 吊销 |

索引：`workspace_id`, `token_hash`。

### 8.2 新表 `mcp_webhooks`

| 列 | 类型 | 说明 |
|---|---|---|
| id | UUID PK | |
| token_id | UUID FK→mcp_tokens CASCADE | |
| workspace_id | UUID FK→workspaces CASCADE | 冗余便于查询 |
| url | String(500) | 回调地址 |
| secret | String(128) | HMAC 密钥（加密存，复用 `get_cipher`） |
| events | JSON | `["worker.completed","worker.failed"]` 或 `["*"]` |
| active | bool | 软停用 |
| created_at | DateTime | |

### 8.3 AgentRun 加列

`agent_runs.read_only`：Boolean nullable default false（nullable 兼容老行）。

### 8.4 alembic 迁移

`2026xxxxxxxx_add_mcp_tokens_webhooks_run_readonly.py`：建 mcp_tokens + mcp_webhooks + agent_runs 加 read_only 列。本项目未上线，无需历史数据回填（CLAUDE.md 规则 11）。

## 9. 兼容策略（brownfield）

- **零侵入**：新增 `/mcp` 端点 + mcp_gateway 模块，不影响任何现有 `/api/*` 路由。
- **内部 stdio MCP server 保留**：`mcp-server.ts` 给主 agent 用，不动。对外远程端点是独立的新 mount。
- **AgentRun.read_only nullable**：老 run 行 NULL，derive_status / 现有查询不受影响。
- **DispatchWorkerRequest.agent_profile_id 可选**：老调用（内部主 agent）不传，行为不变（走兜底链）。
- **现有 5 个 mcp_tools HTTP endpoint 保留**：内部主 agent 还在用；MCP tool handler 复用其背后的 service 层（不删除 endpoint，避免破坏内部链路）。
- **tool_gateway ToolPolicy 不动**：本变更不碰 ToolPolicy（read_only 物制走 daemon SDK `--allowedTools`，与 tool_gateway 正交，CC-02）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | FastMCP mount 到现有 FastAPI 的边界坑（社区 issue #1367） | P1 | W2 早期 spike 验证 mount + 鉴权 middleware 注入；必要时按 issue workaround |
| R-02 | read_only 物制仅 daemon SDK `--allowedTools` 单腿（CC-02 证实 backend ToolPolicy 对 claude worker 永不触发）；依赖传递链端到端通 | P1 | Phase 3 实测确认传递链；文档如实说明 read_only 是 SDK 层物制、非 backend 强制 |
| R-09 | `tool_config` 在 daemon 侧二义（结构体工具治理 vs 凭据 env map，types.ts:186），传递链未验证（CC-03/CC-10） | P1 | Phase 3 端到端实测 + 必要时拆 key（tool_governance vs credential_config） |
| R-03 | webhook 回调需第三方公网端点，本地开发不便 | P2 | 文档给隧道方案（ngrok/cloudflare tunnel）+ SSE 作本地替代 |
| R-04 | mcp Python SDK 版本与 Python 3.12 / async 栈兼容性 | P1 | 加依赖锁版本 + CI 验证 + 早期 spike |
| R-05 | create_mission 起闲置主 agent run（D-004），第三方每次派活有成本 | P2 | 文档说明；后续一次性专家入口 change 解决 |
| R-06 | McpToken 泄漏风险 | P1 | token_hash 不存明文、可吊销、scope 最小化、last_used 审计、文档安全指引 |
| R-07 | D-017 误判已纠正，需 Design Grill 复核对外 MCP server 不触发 agent-consume-MCP 的 SSRF 检查 | P1 | Grill 验证 + 本设计 §1.1 已给出依据 |
| R-08 | gen:types 漂移（管理接口 DTO 变化须同步前端类型） | P2 | 按 CLAUDE.md 规则 20，改 DTO 同 change 内跑 pnpm gen:types + 提交 api-types.ts |

## 11. 决策追踪

| 决策 | 内容 | 覆盖章节 / FR |
|---|---|---|
| D-001@v1 | transport = backend 内置 streamable HTTP MCP 端点 | §5.2 P1 / FR-transport |
| D-002@v1 | 鉴权 = 新建 McpToken 绑 workspace + scope | §5.2 P2, §8.1 / FR-auth |
| D-003@v1 | 通知 = webhook + mission SSE 双通道 | §5.2 P5, §7.3 / FR-notify |
| D-004@v1 | 一次性专家入口本次不做，复用 team mission | §3 NG-1 / 非目标 |
| D-005@v2 | read_only 走 daemon SDK `--allowedTools` 单腿（supersedes v1 的 tool_gateway 双保险——CC-02 证实 ToolPolicy 对 claude worker 永不触发） | §5.2 P3, §8.3, R-02/R-09 / FR-readonly |
| D-006@v1 | MCP 工具补全 list_agent_profiles/create_mission/get_run_logs | §5.2 P6, §7.1 / FR-tools |
| D-007@v1 | MCP 端点实现 = 官方 mcp Python SDK FastMCP mount | §5.2 P1 / FR-impl |

所有 D-xxx@v1 已被设计章节覆盖，无未解决项。R-07 待 Design Grill 复核。

## 12. 自审（Self-Review）

- ✅ 必填章节齐全：背景 / 设计目标 / 非目标 / 拆分判断 / 总体方案 / 文件变更清单 / 接口定义 / 数据模型 / 兼容策略 / 风险登记 / 决策追踪 / 自审。
- ✅ 生命周期契约表：已含（§7.5），覆盖 MCP call → create_mission → dispatch → claim → terminal → webhook/SSE 全链路。
- ✅ 决策引用：D-001~D-007 全部在 §11 追踪，design.md 正文引用一致。
- ✅ 文件变更清单：§6 列出全部新增/修改文件 + 自审存疑标注（complete_lease 钩子位置 / daemon --allowedTools 下发点）。
- ✅ 数据模型：§8 三处变更（两新表 + 一列）+ alembic。
- ✅ 兼容策略：§9 五条零侵入保证。
- ✅ Design Grill（tier=independent 独立审查）已执行，发现并修订：
  - CC-02（P1，已修订）：删除 backend `ToolPolicy` 作为 read_only 物制腿（源码证实孤儿列/永不触发），改 daemon SDK 单腿（§5.2 P3 / D-005@v2）。
  - CC-03（P1，已登记）：`--allowedTools` 传递链矛盾，Phase 3 首步实测厘清（§5.2 P3 / R-09）。
  - CC-08（P2，已修订）：webhook 钩子 host 改 `lease/service.py::complete_lease`（非 router）。
  - CC-09（P2，已修订）：`get_run_logs` 字段 `content` → `content_redacted`（对齐 model.py:391）。
- ⚠️ 仍存疑（交 plan/execute）：
  1. CC-03 `--allowedTools` 端到端实测（Phase 3 首步）。
  2. CC-05 McpToken 无 user 时 `create_mission.created_by` 来源（plan 定）。
  3. CC-07 FastMCP mount + 鉴权 middleware 精确写法（W2 spike，R-01/R-04）。
  4. CC-10 `tool_config` 二义性拆分（Phase 3 实测时定，R-09）。
- 语义一致性 / 可行性 交叉审查已由独立子代理完成（见 .runtime/stage-reviews/）。
