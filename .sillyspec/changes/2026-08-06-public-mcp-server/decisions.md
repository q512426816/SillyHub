---
author: qinyi
created_at: 2026-08-06 13:04:20
---

# 决策台账 — 2026-08-06-public-mcp-server

本次变更的实现/验收影响决策记录。非长期术语表（术语在 archive/scan 时提升到 glossary.md）。

## D-001@v1: 对外 MCP transport = backend 内置 streamable HTTP 端点
- type: architecture
- status: accepted
- source: user
- question: 第三方 agent 通过什么方式连平台 MCP？
- answer: backend FastAPI 内置远程 MCP 端点（FastMCP http_app mount 到 /mcp，streamable HTTP transport），不另起独立网关进程。
- normalized_requirement: 对外 MCP 经 backend `/mcp` 端点暴露，streamable HTTP transport，不新增独立部署进程。
- impacts: FR-transport, §5.2 P1, 文件清单 mcp_gateway/server.py + main.py mount
- evidence: 用户 step3 AskUserQuestion 选「backend 内置远程端点」；mcp-server.ts:35,348 现状纯 stdio
- priority: P0

## D-002@v1: 第三方鉴权 = 新建 McpToken 绑 workspace + scope
- type: architecture/auth
- status: accepted
- source: user
- question: 第三方用什么身份、能碰多大范围？
- answer: 新建 mcp_tokens 表，签发时绑 workspace_id + scope（read/dispatch/converge），独立于现有 user 级 X-API-Key，可独立吊销。
- normalized_requirement: McpToken 绑 workspace + scope 集合，scope 不足的 tool 调用返回 403；token_hash 存不存明文；可吊销。
- impacts: FR-auth, §5.2 P2, §8.1, 文件清单 model.py/service.py/auth.py/router.py
- evidence: 用户 step3 选「新建 MCP token 绑 workspace+scope」；auth_deps.py:150-168 现有 X-API-Key 是 user 级无 scope
- priority: P0

## D-003@v1: 完成通知 = webhook + mission SSE 双通道
- type: architecture
- status: accepted
- source: user
- question: worker 完成后怎么通知第三方编排者（免轮询）？
- answer: webhook（worker 终态 POST 回调，HMAC 签名 + 重试）+ mission SSE（实时进度流）双通道，第三方按需选。
- normalized_requirement: worker 进入终态触发 webhook 投递；提供 mission 级 SSE 端点推状态变更。
- impacts: FR-notify, §5.2 P5, §7.3, §8.2, 文件清单 service.py/sse.py + daemon/lease/service.py::complete_lease 钩子（CC-08：service 层非 router）
- evidence: 用户 step3 选「webhook + SSE 两者」；agent/router.py stream_agent_run_logs 现有 SSE 模式可复用
- priority: P1

## D-004@v1: 一次性专家入口本次不做，复用 team mission
- type: scope/premise
- status: accepted
- source: user
- question: Gap 4 一次性专家入口（免 mission、免闲置主 agent）本次做不做？
- answer: 本次不做，复用 team mission 模式（忍一个闲置主 agent run），留后续独立 change。
- normalized_requirement: 不重构 mission 模型；create_mission 走 OrchestratorService.team_mission_entry（mode=team）；NG-1 写明。
- impacts: §3 NG-1, §5.2 P6 create_mission, R-05
- evidence: 用户 step3 选「本次不做，先靠 team mission」；router.py:847 create_mission mode=team 现有链路
- priority: P0

## D-005@v1: read_only 物理强制走 tool_gateway ToolPolicy + SDK 权限（修订）~~[superseded by D-005@v2]~~
- type: boundary/architecture
- status: superseded
- superseded_by: D-005@v2
- source: code（修订自 user step3 内联决策）
- question: read_only 怎么从 prompt-only 升级为物理强制？放哪层？
- answer: 放弃"新造 daemon 拦截层"原设想，改走已有 tool_gateway + SDK 权限双保险：read_only worker 绑只读 ToolPolicy（排除 file_write/shell_exec）到 run.tool_policy_id + daemon claude --allowedTools 只读集合；read_only 落 AgentRun 新列。
- normalized_requirement: read_only=true 的 worker 物理不可调写工具（backend ToolPolicy 拒 + SDK 权限拒双保险）；agent_runs.read_only 列可审计。
- impacts: FR-readonly, §5.2 P3, §8.3, 文件清单 execution.py + model.py + daemon lease 下发处
- evidence: tool_policy.py:43,70 ToolPolicy.allowed_tools；tool_policy.py:197 ToolPolicyService.check；model.py:187 AgentRun.tool_policy_id 已存在
- priority: P1

## D-006@v1: MCP 工具补全 list_agent_profiles / create_mission / get_run_logs
- type: architecture
- status: accepted
- source: user（原始需求）
- question: 外部编排者纯 MCP 闭环需要哪些工具？
- answer: 新增 3 个 MCP tool：list_agent_profiles（列可用 agent + 能力）、create_mission（复用 OrchestratorService）、get_run_logs（查 AgentRunLog 完整日志），补齐"选 agent / 建 mission / 看完整过程"。
- normalized_requirement: 8 个 MCP tool 覆盖完整闭环；外部编排者不需混用 HTTP。
- impacts: FR-tools, §5.2 P6, §7.1, 文件清单 tools.py
- evidence: mcp_tools.py 现有 5 tool；model.py:336 AgentRunLog；router.py:847 create_mission
- priority: P1

## D-007@v1: MCP 端点实现 = 官方 mcp Python SDK FastMCP mount
- type: architecture
- status: accepted
- source: user
- question: MCP 远程端点用什么实现方案？
- answer: 官方 mcp Python SDK 的 FastMCP，http_app() 出 ASGI app mount 到 FastAPI /mcp；否决方案 B（手写协议易 bug）与 C（依赖第三方非官方库 fastapi-mcp）。
- normalized_requirement: 用官方 mcp SDK；新增 mcp 依赖到 backend pyproject.toml；协议正确性由官方保证。
- impacts: FR-impl, §5.2 P1, 文件清单 server.py + pyproject.toml, R-01/R-04
- evidence: 用户 step4 选「A 官方 FastMCP mount」；WebSearch 确认 FastMCP 支持 http_app mount + streamable HTTP（gofastmcp.com/integrations/fastapi）
- priority: P0

## D-005@v2: read_only 物制走 daemon SDK --allowedTools 单腿
- type: boundary/architecture
- status: accepted
- supersedes: D-005@v1
- source: design-grill（CC-02 独立审查发现）
- question: read_only 物制 backend ToolPolicy 腿是否真的能拦住 claude worker？
- answer: 不能。独立审查 CC-02 证实 `ToolPolicyService.check` 唯一入口是 `POST /workspaces/{lease_id}/tools`（tool_gateway/service.py:156），claude worker 由 daemon 本地 spawn、Read/Write/Edit/Bash 在宿主执行从不调该端点；`AgentRun.tool_policy_id`（model.py:187）是孤儿列（execution/placement/daemon 全无加载）。双保险不成立 → read_only 物制仅靠 daemon SDK `--allowedTools` 单腿。ToolPolicy 是 tool_gateway HTTP 端点独立能力，与 claude worker 正交。
- normalized_requirement: read_only worker 物制 = daemon SDK `--allowedTools` 限定 Read/Glob/Grep（stream-json.ts:333 已消费，但传递链须 Phase 3 实测确认）；不再宣称 backend ToolPolicy 双保险；AgentRun.read_only 列记录审计。
- impacts: FR-readonly, §5.2 P3, §8.3, R-02/R-09, design §6 execution.py 改"修 docstring"非"绑 ToolPolicy"
- evidence: Design Grill CC-02；tool_gateway/service.py:156；execution.py:14-23 docstring；arch doc:313 "未充分使用"
- priority: P1
