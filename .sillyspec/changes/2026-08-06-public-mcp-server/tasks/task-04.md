---
id: task-04
title: spike-A add mcp Python SDK dep and verify FastMCP mount plus auth middleware injection
title_zh: spike-A 加 mcp 官方 SDK 依赖（锁版本）+ 验证 FastMCP mount 到 FastAPI + 鉴权 middleware 注入
author: qinyi
created_at: 2026-08-06 13:57:00
priority: P0
depends_on: [task-03]
blocks: [task-05]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-007@v1]
allowed_paths:
  - backend/pyproject.toml
  - spikes/mcp-fastmcp-mount-spike.md
provides: []
expects_from: {}
goal: >
  验证官方 mcp Python SDK 的 FastMCP http_app() 能 mount 到现有 FastAPI
  （app.mount("/mcp", asgi)），且 task-03 的 McpAuthContext 鉴权 middleware
  能注入到 tool handler 上下文，为 task-05 落地扫清 R-01 / CC-07 / R-04 不确定性。
implementation:
  - 查 mcp 官方 Python SDK 版本（确认 Python 3.12 兼容 + streamable HTTP transport），锁到 backend/pyproject.toml
  - 写最小 spike（1 个 echo tool + FastMCP http_app ASGI + app.mount("/mcp", asgi) + 接 task-03 McpAuthContext middleware 注入），不进生产代码
  - 跑通 MCP 协议三步 initialize / tools/list / tools/call，确认 middleware 注入的 workspace_id 与 scope 在 tool handler 内可读
  - 结论 + 关键代码片段 + 踩到的坑（含社区 issue 1367 mount 边界 workaround）记到 spikes/mcp-fastmcp-mount-spike.md
acceptance:
  - spike 报告 spikes/mcp-fastmcp-mount-spike.md 存在，记 mount 成败 + middleware 注入验证结果 + 锁定的 mcp SDK 版本号
  - mount 成功判定为 /mcp 响应 initialize/tools/list/tools/call 且 tool handler 读到 middleware 注入的上下文
  - 若失败必须记录阻塞点，触发 Wave 2 transport 方案重评（退回方案 B 手写或 C fastapi-mcp），不硬凑结论
verify:
  - spike 报告存在且结论明确（通过或不通过 + 证据为协议三步实测输出与版本号）
constraints:
  - spike 不进生产代码，仅 backend/pyproject.toml 加依赖 + spikes/ 报告，不新增 mcp_gateway 模块文件
  - 必须验证 streamable HTTP transport（官方 2025 推荐），非老 SSE
  - 参考 mcp 社区 issue 1367 的 mount 边界 workaround 处理 app.mount 路径前缀与双 app 冲突
  - 锁定的 SDK 版本须 Python 3.12 兼容（R-04），task-03 的 middleware 挂载精确写法以本 spike 结论为准（CC-07）
---
