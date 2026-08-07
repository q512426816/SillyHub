---
id: task-15
title: docs/mcp full documentation set + pnpm gen:types sync api-types.ts and openapi.json
title_zh: docs/mcp 全套文档 + pnpm gen:types 同步 api-types.ts 与 openapi.json
author: qinyi
created_at: 2026-08-06 14:00:32
priority: P1
depends_on: [task-02, task-06, task-11, task-14]
blocks: []
requirement_ids: [FR-10]
decision_ids: []
allowed_paths:
  - docs/mcp/README.md
  - docs/mcp/getting-started.md
  - docs/mcp/tools-reference.md
  - docs/mcp/webhooks.md
  - docs/mcp/sse.md
  - docs/mcp/security.md
  - frontend/src/lib/api-types.ts
  - backend/openapi.json
provides: []
expects_from: []
goal: >
  落对外 MCP 的生产级文档（design §5.2 P7 / G6）在 docs/mcp/ 下写 6 篇中文为主的文档（总览 / 接入指南 /
  8 工具 reference / webhook / SSE / 安全）并按 CLAUDE.md 规则 20 跑 pnpm gen:types 把 task-02 与 task-11
  新增的 token 与 webhook 管理 API DTO 同步进 frontend/src/lib/api-types.ts 与 backend/openapi.json
  让第三方按文档加同步类型即可闭环接入。
implementation:
  - 写 docs/mcp/README.md 总览加快速开始 串起其余 5 篇与 /mcp 端点加 McpToken 鉴权定位；写 docs/mcp/getting-started.md 接入指南 含 URL 与 token 配置 与 Claude Desktop（claude_desktop_config.json 片段）/ Claude Code（.mcp.json 片段）/ Cursor 三端可复制配置示例
  - 写 docs/mcp/tools-reference.md 8 个 tool（list_agent_profiles / create_mission / dispatch_worker / list_workers / get_worker_result / get_run_logs / converge_mission / report_progress）逐个列 input 与 output schema 加调用示例加错误码 字段以 task-06 与 task-14 落地 inputSchema 与 design §7.1 为准
  - 写 docs/mcp/webhooks.md 含注册端点与 payload 格式与 HMAC-SHA256 X-Signature 签名校验代码示例（Python 与 Node 两版）与指数退避重试（1s/4s/16s/64s 最多 5 次）对齐 task-11 与 design §7.3
  - 写 docs/mcp/sse.md mission SSE 订阅端点 GET /workspaces/<wid>/missions/<mid>/events 与事件类型（worker 状态变更）复用 task-13 stream_agent_run_logs 模式；写 docs/mcp/security.md 含 scope 模型（read / dispatch / converge 与 8 tool 对应表）与 token 吊销流程与本地开发隧道方案（ngrok 与 cloudflare tunnel，R-03）与 token_hash 不存明文等注意事项
  - gen:types 前在 frontend 目录确认 node_modules 健康（pnpm exec tsc --version 能跑且 .bin 有 shim）半坏则 pnpm install --force 修复再跑 pnpm gen:types 同步 token 与 webhook CRUD DTO 到 api-types.ts 与 openapi.json 若暴露与本改动无关的旧测试债（如 mock 缺字段）顺手补好不躲报错
acceptance:
  - docs/mcp/ 下 6 篇 .md 文件齐全且内容覆盖 design §5.2 P7 全部要点（接入指南 / 8 工具 reference / webhook / SSE / 错误码 / 安全加隧道）
  - getting-started 含三端配置示例片段且 tools-reference 8 tool 逐个含 input 与 output schema 加调用示例加错误码
  - webhooks 含 HMAC 签名校验代码示例且 security 含 scope 模型与 token 吊销与本地隧道方案
  - pnpm gen:types 后 api-types.ts 与 openapi.json 含 token 与 webhook 管理 API 请求与响应 DTO 无手写漂移 且 pnpm exec tsc --noEmit 通过
verify:
  - cd frontend && pnpm exec tsc --version
  - cd frontend && pnpm gen:types
  - cd frontend && pnpm exec tsc --noEmit
  - 校验 docs/mcp/README.md 与 getting-started.md 与 tools-reference.md 与 webhooks.md 与 sse.md 与 security.md 6 个文件均存在
constraints:
  - 文档以中文为主 专业术语（MCP / HMAC / SSE / scope / token 等）保留英文 遵循 CLAUDE.md 规则 12
  - 接入指南必须含 Claude Desktop（claude_desktop_config.json）/ Claude Code（.mcp.json）/ Cursor 三端配置示例片段 URL 与 Bearer token 写法可直接复制
  - tools-reference 8 tool 逐个列 input 与 output schema 加调用示例加错误码 字段对齐 task-06 与 task-14 落地 inputSchema 与 design §7.1 不自造字段
  - webhooks 文档含 HMAC-SHA256 签名校验代码示例（至少 Python 与 Node 一版）payload 与重试策略对齐 design §7.3 与 task-11；security 文档含 scope 模型与 token 吊销流程与本地隧道方案（ngrok 与 cloudflare tunnel，R-03）与不存明文等注意事项
  - gen:types 前先确认 frontend node_modules 健康（pnpm exec tsc --version 能跑）半坏会报假的 CSSProperties 或 Cannot find module 类报错 用 pnpm install --force 修复（CLAUDE.md 规则 20）；gen:types 暴露与本改动无关的旧测试债（如 mock 缺字段）顺手补好 不为躲报错改回手写
  - 文档事实以 task-02 与 task-06 与 task-11 与 task-14 落地的实际接口与 inputSchema 为准 有出入以代码为准回头修文档不自造行为
---
