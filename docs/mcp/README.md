# SillyHub 对外 MCP 接入文档总览

本目录是 SillyHub **对外 MCP（Model Context Protocol）服务**的接入与参考文档，面向
第三方编排方（外部 agent / 自动化系统），按文档即可把 SillyHub 的多 agent 编排能力
接入自己的工具链。

## 这是什么

SillyHub 把一个 team mission（多 worker agent 协同完成一个目标）的编排能力，通过标准
MCP 协议暴露给第三方。第三方 MCP client（Claude Desktop / Claude Code / Cursor / 自建
agent 框架）连上后，可以列 agent 档案、建 mission、派 worker、看日志、读产出、触发收敛，
全程无需登录 SillyHub 前端。

- **端点**：`https://<host>/mcp/`（**带尾斜杠**，streamable HTTP transport）。
- **协议版本**：`2025-11-25`。
- **传输**：streamable HTTP（2025 官方推荐，取代旧 SSE transport）。
- **鉴权**：`Authorization: Bearer <McpToken>`。McpToken 是 workspace 级长期凭证，由
  workspace owner/admin 签发，决定你能访问哪个 workspace、能做哪些操作（scope）。

## 6 篇文档导航

| 文档 | 内容 |
| --- | --- |
| [getting-started.md](getting-started.md) | 接入指南：拿到 URL + token，Claude Desktop / Claude Code / Cursor 三端可复制配置示例 |
| [tools-reference.md](tools-reference.md) | 8 个 MCP tool 的 input / output schema、调用示例、错误码 |
| [webhooks.md](webhooks.md) | 注册 webhook 收 worker 终态推送，HMAC-SHA256 签名校验（Python + Node），指数退避重试 |
| [sse.md](sse.md) | mission 级 SSE 订阅 worker 状态变更，重连 / 事件补发策略 |
| [security.md](security.md) | scope 模型、token 吊销、本地开发隧道（ngrok / cloudflare tunnel）、不存明文等注意事项 |

## 快速开始（3 步）

1. **拿 token**：让 workspace owner/admin 调
   `POST /api/workspaces/{workspace_id}/mcp-tokens` 签发一个 McpToken（明文只返回一次，
   立即保存）。详见 [security.md](security.md)。
2. **配 client**：把 `https://<host>/mcp/` 和 token 填进你的 MCP client。三端配置示例见
   [getting-started.md](getting-started.md)。
3. **调 tool**：先 `list_agent_profiles` 选 agent，再 `create_mission` 建任务，用
   `dispatch_worker` 派 worker，`get_run_logs` / `get_worker_result` 跟进，
   `converge_mission` 收尾。完整字段见 [tools-reference.md](tools-reference.md)。

## 两类通道，别混淆

| 通道 | 路径 | 鉴权 | 用途 |
| --- | --- | --- | --- |
| MCP tool 通道 | `/mcp/`（streamable HTTP） | `Bearer <McpToken>` | 第三方调 8 个 tool（本目录主要讲这个） |
| 管理 / 推送 API | `/api/...` | 平台用户 JWT / X-API-Key | token / webhook 的 CRUD、mission SSE |

token 与 webhook 的**管理端点**（签发 / 列表 / 吊销 / 注册 webhook）走 `/api`，要平台
用户身份（owner/admin），不是 McpToken。mission SSE 推送端点也走 `/api`。这两类通道
鉴权物理隔离，详见各文档与 [security.md](security.md)。
