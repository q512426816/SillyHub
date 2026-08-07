---
author: qinyi
created_at: 2026-08-06 13:23:21
---

# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 第三方编排者 | 外部 MCP 客户端（Claude Code / Desktop / Cursor / 任意标准 MCP 客户端），消费平台 MCP |
| workspace owner / admin | 签发/吊销 McpToken、注册/停用 webhook |
| worker agent | 被 dispatch 的平台 agent（read_only 审查型 / 写执行型） |

## 功能需求

### FR-01: 对外 MCP 远程端点（streamable HTTP）
覆盖决策：D-001@v1, D-007@v1
Given backend FastAPI 运行且 mcp_gateway 模块已挂载
When 第三方经 streamable HTTP 连接 `/mcp`
Then FastMCP mount 正确响应 MCP 协议（initialize / tools/list / tools/call），8 个 tool 可被发现与调用

### FR-02: McpToken 鉴权
覆盖决策：D-002@v1
Given workspace owner 已签发 McpToken（绑 workspace_id + scope 集合）
When 第三方带 `Authorization: Bearer <McpToken>` 调 `/mcp`
Then middleware 校验 token_hash（未吊销、缓存命中优先）+ 注入 workspace_id/scope 到 tool 上下文；无效/吊销 token 返回 401

### FR-03: scope 权限控制
覆盖决策：D-002@v1
Given 某 McpToken scope = [read, dispatch]（无 converge）
When 第三方调用 `converge_mission` tool
Then 返回 403（scope 不足），且决策日志记录拒绝

### FR-04: dispatch 绑 AgentProfile
覆盖：design §5.2 P4（复用 `AgentRun.agent_profile_id` `model.py:133-145`）
Given workspace 下存在 AgentProfile
When 第三方 `dispatch_worker` 传 `agent_profile_id`
Then `run.agent_profile_id` 写入 + `agent_profile_snapshot` 冻结该 profile 快照；profile 不属该 workspace 返回 400

### FR-05: read_only 物理强制
覆盖决策：D-005@v2
Given read_only worker 经 Phase 3 实测确认 `--allowedTools` 传递链通
When worker 执行
Then 仅 Read/Glob/Grep 可用，写工具（Edit/Write/Bash）被 daemon SDK 层拒绝
（边界：若 Phase 3 实测发现传递链断，先补通/拆 `tool_config` 二义 key 再验收，R-09）

### FR-06: read_only 落 run 记录
覆盖决策：D-005@v2
Given worker dispatch 时 read_only=true
When AgentRun 创建
Then `agent_runs.read_only` 列记录为 true（nullable bool 兼容老行 NULL）；前端/审计可查询

### FR-07: webhook 完成通知
覆盖决策：D-003@v1
Given workspace 注册了 webhook（url + secret + events）
When worker 进入终态（completed / failed / killed）
Then backend POST 事件 payload 到 url + `X-Signature: HMAC-SHA256(secret, body)`；失败按指数退避重试最多 5 次

### FR-08: mission SSE 实时进度
覆盖决策：D-003@v1
Given mission 下有 worker 运行
When 第三方订阅 `GET /workspaces/{wid}/missions/{mid}/events`
Then 返回 `text/event-stream`，推送 worker 状态变更事件（复用 `stream_agent_run_logs` 模式）

### FR-09: MCP 工具补全
覆盖决策：D-006@v1
Given 8 个 MCP tool 已注册
When 第三方调用 `list_agent_profiles` / `create_mission` / `get_run_logs`
Then 分别返回：profile 清单（id/name/description/provider/model/tools_summary）/ 建 mission（复用 `OrchestratorService.team_mission_entry`）/ run 日志（AgentRunLog，字段含 `content_redacted`）

### FR-10: 生产级文档
覆盖：design G6
Given `docs/mcp/` 已生成
When 第三方按文档接入
Then 覆盖：接入指南（Claude Desktop/Code/Cursor 配置示例）/ 8 工具 reference / McpToken 鉴权 / webhook+SSE / 错误码字典 / 安全 + 本地隧道方案

## 非功能需求
- **兼容性**：零侵入现有 `/api/*` 路由、内部 stdio MCP server、已有 run 行（AgentRun.read_only nullable）。
- **可回退**：mcp_gateway 为独立模块，不挂载 `/mcp` 即回退；McpToken/webhook 表存在不影响现有逻辑。
- **可测试**：token 鉴权 / scope 拒绝 / 8 tool handler / webhook 投递 / SSE 均有单测（含 CC-03 端到端实测）。
- **跨平台**：Windows / Linux / macOS（CLAUDE.md 规则 13）。
- **类型同步**：管理接口 DTO 改动须 `pnpm gen:types` 同步 `api-types.ts` + `openapi.json`（CLAUDE.md 规则 20）。

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-01 | transport = backend 内置 streamable HTTP 端点 |
| D-002@v1 | FR-02, FR-03 | McpToken 绑 workspace + scope |
| D-003@v1 | FR-07, FR-08 | webhook + mission SSE 双通道 |
| D-004@v1 | （非目标 NG-1） | 一次性专家入口本次不做，复用 team mission |
| D-005@v2 | FR-05, FR-06 | read_only 走 daemon SDK `--allowedTools` 单腿 |
| D-006@v1 | FR-09 | MCP 工具补全 3 个 |
| D-007@v1 | FR-01 | 端点实现 = 官方 mcp Python SDK FastMCP mount |

全部当前版本 D-xxx@vN 已被 FR 或非目标覆盖，无未覆盖决策。
