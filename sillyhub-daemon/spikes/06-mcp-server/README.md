# spike-01：daemon 内置 stdio MCP server 可行性验证

> 2026-07-12-team-main-agent-orchestration task-05 前置 spike。最大技术不确定性。
> 不通过要退方案 A（backend 主动 GLM 决策循环，主 agent 无工具能力）。

## spike 目标

验证主 agent（claude/codex）经 `--mcp-config` 注入能否调到 daemon 内置 stdio MCP
server，tool_call 能否路由到 hub-client → backend 派 worker。

## 通过标准

MCP 客户端（模拟主 agent）能调 `dispatch_worker` tool 并收到 worker 状态回执。

## 不通过后果

task-05 推翻，退方案 A（backend 主动 GLM 决策循环，主 agent 无工具能力）。

## 结论：通过

5/5 测试全绿，核心链路全部验证：

| 验证点 | 结果 |
|---|---|
| MCP server 能启动（stdio transport，不 crash） | 通过 |
| `dispatch_worker` tool 能被 `client.listTools()` 发现（含 inputSchema + required） | 通过 |
| `client.callTool()` 能调到 tool，tool handler 调 backend | 通过 |
| backend mock 收到正确 HTTP 请求（路径/方法/Bearer 鉴权头/snake_case body） | 通过 |
| 回执结构正确（worker_run_id / status / lease_id / error_code） | 通过 |
| backend 不可达时不 crash，返回结构化 `isError` 回执 | 通过 |
| backend 非 2xx 时返回结构化错误（不 crash） | 通过 |
| backend 业务层 error_code（no_online_daemon）透传，不当 transport 错误 | 通过 |

## 代码清单

```
spikes/06-mcp-server/
  server.ts          最小 stdio MCP server（McpServer + StdioServerTransport + dispatch_worker tool）
  spike.test.ts      MCP 客户端测试 + mock backend HTTP server
  README.md          本文档
vitest.spikes.config.ts   spike 专用 vitest config（spikes 不在默认 include 里）
```

依赖变更（package.json，task-05 复用）：
- `@modelcontextprotocol/sdk` `^1.29.0`
- `zod` `^4.4.3`（SDK peer dep，inputSchema 用 zod raw shape；之前只作为
  claude-agent-sdk 的间接 peer 存在，未 hoist 到顶层，需显式声明）

## 关键设计决策

### 1. 用高层 McpServer 而非底层 Server

SDK 1.29.0 提供两层 API：
- 底层 `Server`（`@modelcontextprotocol/sdk/server`）+ `setRequestHandler`（手动 zod schema）
- 高层 `McpServer`（`@modelcontextprotocol/sdk/server/mcp.js`）+ `registerTool`（zod raw shape，自动转 JSON Schema）

spike 用高层 API：`registerTool(name, {description, inputSchema: ZodRawShape}, cb)`，
inputSchema 直接是 zod raw shape（如 `{objective: z.string(), role: z.string().optional()}`），
SDK 自动转 JSON Schema 暴露给主 agent。task-05 扩展 5 tool 沿用此模式。

### 2. tool schema 对齐 backend 真实契约（非 task 描述草案）

task 描述的 schema 是 `{mission_id, worker_id, agent_type, model, objective, role}`，
但 backend `mcp_tools.py` `DispatchWorkerRequest` 真实契约是：
- 路径参数：`workspace_id` + `mission_id`
- body：`{objective, role?, agent_type?, model?, read_only?}`
- **无 `worker_id`**（worker run id 由 backend 创建后返回，不在请求里）

spike 以 backend 真实契约为准。task-05 实现时需同步修正 task card 的 schema 描述。

### 3. 鉴权模式：Bearer token 透传

对齐 `hub-client.ts` `_headers()`（:252）：`Authorization: Bearer <token>` +
`Content-Type: application/json`，body 是 snake_case JSON，非 2xx 抛错。

spike server 从 `MCP_SERVER_DAEMON_TOKEN` 读 token。生产对接时，这个 token 应是
主 agent run 的 daemon lease 携带的 user token（backend mcp_tools.py 需
`WORKSPACE_WRITE` 权限，由 user token 提供）。task-05 接 hub-client 真实方法时，
token 来源 = 主 agent run 的 lease context（不是 daemon 长期 apiKey，因为 mcp_tools
走 user 权限校验，见 mcp_tools.py:11 注释）。

### 4. 错误处理：结构化 isError 回执，不 crash server

- backend 不可达 / 非 2xx → `isError: true` + `{error, message}` JSON content
- backend 业务层 error_code（如 no_online_daemon）→ HTTP 201，**不是 transport 错误**，
  透传到回执的 `error_code` 字段，主 agent 读决定重派

stderr 写诊断信息（如 env 未配置），不污染 stdout JSON-RPC 通道。

### 5. server 运行方式：Node v24+ 原生 TS

spike server 是 `.ts`，测试用 `process.execPath`（绝对 node 路径）直接跑，
依赖 Node v24+ 原生 TypeScript strip-types。跨版本兼容方案（task-05 生产）：
- 用 `tsc` 编译到 `dist/`（daemon 已有 build script），mcp-config 指向 `node dist/mcp-server.js`
- 或加 `tsx` devDependency 跑 dev 模式

## mcp-config 配置（指向本 server）

对齐 `mcp-config.ts` `McpServerConfig`：

```json
{
  "mcpServers": {
    "sillyhub-daemon": {
      "command": "node",
      "args": ["/absolute/path/to/sillyhub-daemon/spikes/06-mcp-server/server.ts"],
      "env": {
        "MCP_SERVER_BACKEND_URL": "http://localhost:8000",
        "MCP_SERVER_DAEMON_TOKEN": "<主 agent run 的 user token>"
      }
    }
  }
}
```

注：`mcp-config.ts` `injectMcpConfig()` 会把合并后的配置写到临时 `.mcp.json`，
spawn claude 时传 `--mcp-config <path>`。task-05 需在 daemon spawn 主 agent 时：
1. 把 daemon 内置 MCP server 加入 platform_default（admin 配置或硬编码）
2. 注入主 agent run 的 user token 到 env
3. server 路径用编译产物（`dist/mcp-server.js`）而非 `.ts`

## 用 claude code CLI 手动验证（端到端）

```bash
# 1. 起 backend（或 mock）+ 拿一个有 WORKSPACE_WRITE 权限的 user token
# 2. 写 .mcp.json（按上面格式，token 填真实 user token）
# 3. 让 claude code 加载这个 mcp-config
claude --mcp-config /tmp/.mcp.json
# 4. 在 claude 会话里让 agent 调 dispatch_worker：
#    "用 dispatch_worker 工具给 mission <mid> 派一个 worker，目标是实现 X"
# 5. 观察返回的 worker_run_id / status 回执
```

spike 测试已用 mock backend 覆盖完整链路，手动验证只需在真实 backend + 真实 claude CLI
下复现一次（task-05 实现后做）。

## 跑测试

```bash
cd sillyhub-daemon
pnpm exec vitest run --config vitest.spikes.config.ts
```

spikes 不在默认 `vitest.config.ts` 的 include（`tests/**/*.test.ts`）里，
专用 config 隔离 spike 测试，不污染主测试套件 / CI。

## 测试结果

```
 ✓ spikes/06-mcp-server/spike.test.ts (5 tests) 1484ms
   ✓ exposes dispatch_worker tool via listTools
   ✓ routes dispatch_worker tool_call to backend and returns worker status receipt
   ✓ returns structured error when backend unreachable (no crash)
   ✓ returns structured error when backend returns non-2xx
   ✓ handles no_online_daemon error_code from backend (worker run still created)

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## 对 task-05 的建议

spike 验证可行，task-05 在此基础上扩展：

### 扩展 5 tool

backend `mcp_tools.py` 已建 5 endpoint，spike 只实现 dispatch_worker。task-05 补：

| tool | backend endpoint | method |
|---|---|---|
| `dispatch_worker` | `/workspaces/{ws}/missions/{mid}/dispatch_worker` | POST（spike 已实现） |
| `get_worker_result` | `/workspaces/{ws}/missions/{mid}/workers/{wid}/result` | GET |
| `list_workers` | `/workspaces/{ws}/missions/{mid}/workers` | GET |
| `converge` | `/workspaces/{ws}/missions/{mid}/converge` | POST |
| `report_progress` | `/workspaces/{ws}/missions/{mid}/progress` | POST |

### 接 hub-client 真实方法

spike server 直接用 `fetch` 调 backend（独立实现鉴权）。task-05 应：
- 复用 `hub-client.ts` 已有方法或新增薄封装（保持鉴权/错误处理一致）
- token 来源：主 agent run 的 lease context（user token，非 daemon apiKey）
- server handler 从 MCP server 的 env / 启动上下文拿 backend URL + token

### mcp-config 注入方式

task-05 在 daemon spawn 主 agent 时：
1. daemon 内置 MCP server 作为 platform_default 的一项（硬编码或 admin 配置）
2. `injectMcpConfig()` 写临时 `.mcp.json`，server env 注入：
   - `MCP_SERVER_BACKEND_URL` = daemon config 的 serverUrl
   - `MCP_SERVER_DAEMON_TOKEN` = 主 agent run 的 user token（从 lease context 取）
3. server 命令用 `node dist/mcp-server.js`（编译产物，跨 Node 版本兼容）
4. mcp-config.ts `mergeMcpConfigs` 白名单需包含 daemon 内置 server 名

### 生产化要点

- server 代码从 `spikes/` 移到 `src/mcp-server/`（进 tsc 编译 + ncc bundle）
- 加日志（stderr，对齐 daemon 现有 logger 风格，不污染 stdout）
- 超时 / 重试策略对齐 hub-client `DEFAULT_TIMEOUT_MS`
- tool handler 异步并发安全（多 tool_call 并发时 backend 调用隔离）

## 阻塞问题

无。SDK API 清晰，stdio 通信正常，跨平台用 `process.execPath` + 绝对路径启动
规避了 PATH 依赖。zod 显式依赖是唯一需要补的（已加 package.json）。
