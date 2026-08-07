---
author: qinyi
created_at: 2026-08-06 13:23:21
---

# 提案书（Proposal）

## 动机
平台已有内部多 agent 编排能力（`mcp_tools.py` 5 个 HTTP 端点 + daemon stdio MCP server 注入主 agent），但只对平台内部主 agent 可用。第三方编排者（外部 Claude Code/Desktop/Cursor 等）无法连入；现有鉴权无对外口径；4 项能力 gap 阻碍纯 MCP 闭环。本提案把这套能力升级为**对外暴露的生产级 MCP 服务**，第三方配置 URL + token 即接入，外部编排链路（连接 → 选 agent → 派活 → 看记录 → 拿回馈）闭环，配套生产级文档。

## 关键问题
1. **transport 限制**：现有 MCP server 纯 stdio（`mcp-server.ts:35,348`），第三方远程连不上。
2. **鉴权无对外口径**：现有 X-API-Key 是 user 级长期 key（`auth_deps.py:150-168`），继承该 user 全部 workspace 权限、无 scope、不可独立吊销——给第三方风险面大。
3. **4 项能力 gap**：
   - dispatch 绑不了 AgentProfile（`mcp_tools.py:55` `DispatchWorkerRequest` 无 `agent_profile_id`，"选了 agent 传不下去"）；
   - read_only 仅 prompt 建议（`mcp_tools.py:359`），无物理强制（且 Design Grill CC-02 证实原设想的 backend ToolPolicy 腿对 claude worker 永不触发）；
   - 完成无主动通知，第三方只能轮询 `list_workers`；
   - 缺 `list_agent_profiles`/`create_mission`/`get_run_logs`，外部编排要"列 agent/建 mission/看完整日志"得绕回 HTTP，纯 MCP 闭环不了。

## 变更范围
- 新增 `backend/app/modules/mcp_gateway/`：官方 `mcp` Python SDK FastMCP mount 到 FastAPI `/mcp`（streamable HTTP transport），8 个 tool handler 复用 service 层。
- 新增 McpToken 鉴权（绑 workspace + scope 集合 read/dispatch/converge，token_hash 存、独立吊销，Redis 缓存）。
- read_only 物制走 daemon SDK `--allowedTools` 单腿（Phase 3 首步端到端实测确认传递链，CC-03/R-09）+ `AgentRun.read_only` 列记录审计。
- dispatch 绑 AgentProfile（复用 `AgentRun.agent_profile_id`/`agent_profile_snapshot` 已有字段，不改表）。
- 完成通知：webhook（worker 终态 POST + HMAC 签名 + 重试）+ mission SSE（实时进度）。
- MCP 工具补全 `list_agent_profiles`/`create_mission`/`get_run_logs`。
- 生产级 `docs/mcp/` 文档（接入/工具/鉴权/通知/错误码/安全）。

## 不在范围内（显式清单）
- **不做** 一次性专家入口（免 mission/免闲置主 agent）—— 复用 team mission（D-004@v1 / NG-1），留后续 change。
- **不做** OAuth2 / 开放生态多租户自主注册。
- **不做** 改造内部 stdio MCP server（给主 agent 用，保留不动）。
- **不做** 前端 McpToken/webhook 管理 UI（仅提供 HTTP 管理接口）。
- **不做** mission 模型重构（AgentRun 仅加 read_only 列）。

## 成功标准（可验证）
- 第三方配 URL + McpToken 经 streamable HTTP 连上 `/mcp`，Claude Desktop/Code/Cursor 即插即用。
- McpToken 绑 workspace + scope，scope 不足的 tool 调用返回 403；可独立吊销，吊销后立即失效。
- read_only worker 经实测被限成 Read/Glob/Grep（daemon SDK 层物制，传递链端到端通）。
- dispatch 传 `agent_profile_id` 后 worker run 冻结对应 `agent_profile_snapshot`；profile 不属该 workspace 返回 400。
- worker 进入终态触发 webhook 投递（带 `X-Signature` HMAC）；mission SSE 推状态变更。
- 8 个 MCP tool 纯 MCP 闭环（外部编排不混 HTTP）。
- 现有 `/api/*` 路由 / 内部 stdio MCP server / 已有 run 行 **零回归**（AgentRun.read_only nullable 兼容）。
- `docs/mcp/` 覆盖接入指南/工具清单/鉴权/通知/错误码/安全/本地隧道方案。
