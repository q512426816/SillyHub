---
schema_version: 1
doc_type: module-card
module_id: mcp-server
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 内置 MCP 服务器（mcp-server）

## 定位

daemon 内置 stdio MCP server，独立进程运行（`node dist/mcp-server.js`）。team 模式
主 agent 经 `--mcp-config` 注入本 server，tool 调用经 HubClient 路由到 backend
mcp_tools 5 endpoint（派 worker / 读产出 / 列 worker / 收敛 / 报进度）。与 backend
公开 gateway（链路B）schema 同构；**仅 stage=orchestrator 的主 agent session 注入**
（普通 scan/stage/chat 不注入，零回归）。

## 契约摘要

- `createMcpServer(client: HubClient)`：构造 McpServer + 注册 5 tool，返回
  `{ server }`（client 可注入 mock，测试不经 stdio 断言 tool 注册）。
- `runMcpServer()`：生产入口——env 构造 HubClient + StdioServerTransport 启动。
- `DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon'`。
- 5 工具（registerTool×5，schema 对齐 backend mcp_tools.py）：
  - `dispatch_worker`：workspace_id / mission_id / objective + 可选 role /
    agent_type / model / read_only / worktree_path / branch / worker_prompt。
  - `get_worker_result`：workspace_id / mission_id / worker_id。
  - `list_workers`：workspace_id / mission_id。
  - `converge_mission`：workspace_id / mission_id。
  - `report_progress`：workspace_id / mission_id / run_id / message + 可选
    decision（决策标签，写 AgentRunLog channel=tool_call）。
- 环境变量：MCP_SERVER_BACKEND_URL / MCP_SERVER_DAEMON_API_KEY /
  MCP_SERVER_DAEMON_TOKEN。

## 关键逻辑

```
鉴权(两路分开): daemonApiKey 非空 → HubClient({ apiKey })   # X-API-Key 路径
               否则           → HubClient({ token })        # Bearer JWT 回落
               # backend get_current_principal 解析 apiKey → User → WORKSPACE_WRITE
handler 回执: 成功 → okContent(backend 响应原样 JSON 序列化到 content[0].text)
  失败 → errorContent 不 crash: HubHttpError→error:'http'(+status) /
  TypeError(fetch 网络层)→error:'network' / 其他→error:'internal'
isMain: import.meta.url === pathToFileURL(process.argv[1]).href
```

## 注意事项

- **X-API-Key / Bearer 分开透传**（task-09 P0 鉴权 gap 闭合）：daemon apiKey 优先
  走 X-API-Key；旧实现把 apiKey 塞 MCP_SERVER_DAEMON_TOKEN 当 Bearer 发 → backend
  Bearer 路径只解 JWT → 401，5 endpoint 全不可达。mcp-config 侧相应分写两个 env。
- **仅主 agent 注入**：cli.ts `isMainAgentSession: (ctx) => ctx.stage ===
  'orchestrator'` 谓词（lease.metadata.stage → CreateSessionInput.stage →
  MainAgentMcpContext.stage）；会话恢复时按 record.stage==='orchestrator' 重新注入。
- env 缺失仍启动 server（tool 调用返回结构化错误便于诊断，不 crash）。
- dispatch_worker 路径A 字段（worktree_path/branch/worker_prompt）全 optional：
  不传 → undefined → hub-client 守卫不写入 body → backend None → 原 team 模式
  自建 worktree（零回归）。
- 无 createMission 工具（仅 5 tool）；create_mission 走 backend /api 直连或链路B。
- schema 三端同构（backend mcp_tools.py DispatchWorkerRequest + 链路B gateway +
  本文件）；改字段名会打破跨仓契约与 path-a probe 探测。
- Windows 坑（ql-20260712-002）：isMain 判断必须 pathToFileURL 规范化——直接字符串
  拼 `file://${argv[1]}` 在 Windows 得两斜杠 URL 恒 false → server 子进程不启动。
- tsc 编译产物供 Node 20 兼容（不能直跑 .ts）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
