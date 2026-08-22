---
author: qinyi
created_at: 2026-08-22 07:09:13
---

# spike-01：验证 design R-04 —— options.mcpServers 能否为 MCP server 子进程注入自定义 env（MCP_SESSION_ID）

## 结论：PASS

Claude Agent SDK（0.3.181）+ Claude Code CLI（2.1.216）完整支持 per-server `env` 注入。
task-10 按原方案执行：在 `mcpServers['sillyhub-daemon'].env` 里追加 `MCP_SESSION_ID`，
MCP server 子进程（`mcp-server.ts`）经 `process.env.MCP_SESSION_ID` 读取。无需 fallback。

## 证据链（完整透传路径）

### 1. daemon 侧：mcpServers 结构与赋值点

- `sillyhub-daemon/src/interactive/claude-sdk-driver.ts:392-409`
  `options.mcpServers = opts.mcpServers`（:407-409），注释已声明结构与 SDK
  `McpStdioServerConfig` 兼容（`{ [name]: { command, args?, env? } }`，`type` 可选默认 stdio）。
- `sillyhub-daemon/src/mcp-config.ts:315-335`（buildDaemonMcpServerConfig）
  现有 server config 形态：`{ command: 'node', args: [<dist/mcp-server.js>], env: { MCP_SERVER_BACKEND_URL, MCP_SERVER_DAEMON_TOKEN, MCP_SERVER_DAEMON_API_KEY? } }`（env 构造在 :322-329）。

### 2. SDK 类型层：env 字段存在于 mcpServer 类型

- `sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1620`
  `mcpServers?: Record<string, McpServerConfig>`
- `sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:994`
  `type McpServerConfig = McpStdioServerConfig | McpSSEServerConfig | McpHttpServerConfig | McpSdkServerConfigWithInstance`
- `sillyhub-daemon/node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts:1092-1096`
  `McpStdioServerConfig = { type?: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; ... }`
  —— **`env?: Record<string, string>` 官方类型支持，无 `type:'sdk'` 限制（stdio 直传）**。

### 3. SDK 运行时：mcpServers 原样序列化给引擎进程

- `.../claude-agent-sdk/sdk.mjs`（0.3.181，minified，ProcessTransport.initialize，行 60 内）：
  `if(Ft&&Object.keys(Ft).length>0)V.push("--mcp-config",pe({mcpServers:Ft}))`
  （`Ft` = options.mcpServers 解构，`pe` = JSON.stringify）
  —— SDK 不做任何字段过滤/剥离，**含 `env` 的完整对象 JSON 序列化后经 `--mcp-config` CLI 参数传给 claude.exe**。

### 4. CLI 引擎层：spawn MCP server 子进程时合并 per-server env（关键证据）

- `C:\Users\qinyi\.local\bin\claude.exe`（2.1.216，本机实际使用的 executable，
  由 `resolveClaudeExecutable` 解析，见 claude-sdk-driver.ts:76），二进制内嵌 JS bundle
  StdioClientTransport.start（字节偏移 ≈237738455）：
  ```js
  this._process = spawn(this._serverParams.command, this._serverParams.args ?? [], {
    env: { ...Las(), ...this._serverParams.env },   // ← per-server env 覆盖式合并
    stdio: ["pipe","pipe", this._serverParams.stderr ?? "inherit"],
    shell: false, windowsHide: <win32>, cwd: this._serverParams.cwd })
  ```
  `Las()` 是安全白名单基线（偏移 ≈237740207）：
  win32 = APPDATA/HOMEDRIVE/HOMEPATH/LOCALAPPDATA/PATH/PROCESSOR_ARCHITECTURE/
  SYSTEMDRIVE/SYSTEMROOT/TEMP/USERNAME/USERPROFILE/PROGRAMFILES；
  POSIX = HOME/LOGNAME/PATH/SHELL/TERM/USER。
  —— **`...this._serverParams.env` 排在后面：per-server env 全量并入子进程环境，
  `MCP_SESSION_ID` 必然出现在子进程 `process.env`**。

### 5. 生产旁证：同一机制已在用

- `sillyhub-daemon/src/mcp-server.ts:61-63` 已在读
  `process.env.MCP_SERVER_BACKEND_URL / MCP_SERVER_DAEMON_API_KEY / MCP_SERVER_DAEMON_TOKEN`，
  它们正是经 `buildDaemonMcpServerConfig` 的 per-server `env` 注入的
  （tests/mcp-config.test.ts:153-200 断言该 env 形态）。
  MCP_SESSION_ID 走完全相同的管道，无新机制。

## 对 task-10 的执行指令

1. **按原方案实现**：`buildDaemonMcpServerConfig` 增加 `sessionId` 参数（或调用方
   在合并后的 server config 上追加），写入 `env.MCP_SESSION_ID = sessionId`；
   spawn 主 agent 时（每次新 spawn / resume 都要重构造 config，session_id 变化即变 env）。
2. **mcp-server.ts 侧**：`process.env.MCP_SESSION_ID ?? ''` 读取，注入 5 个 tool
   （dispatch_worker / get_worker_result / list_workers / converge_mission /
   report_progress）的后端调用上下文；空值走现有结构化错误路径（与 token 缺失同模式）。
3. **重要设计约束（本次 spike 发现）**：MCP server 子进程**不继承** claude.exe 的完整
   环境变量，只继承白名单（PATH/HOME 等 12 个）+ per-server `env`。因此：
   - 把 `MCP_SESSION_ID` 放顶层 `options.env`（driver :372）**无效**，到不了 MCP 子进程；
   - 必须放在 `mcpServers['sillyhub-daemon'].env` 里——与 R-04 原方案一致。
4. **测试**：单测断言 `cfg.env.MCP_SESSION_ID` 形态（对齐 mcp-config.test.ts:153-200
   现有写法）；无需 fallback（5 工具显式 session_id 参数方案不启用）。
5. 风险提示（低）：env 合并行为属 Claude Code CLI 上游实现（本机 2.1.216 已验证），
   与 MCP_SERVER_DAEMON_API_KEY（P0 鉴权）共享同一依赖面，版本升级风险共担，无增量风险。

## 版本快照

- @anthropic-ai/claude-agent-sdk 0.3.181（sillyhub-daemon pnpm 锁定）
- Claude Code CLI 2.1.216（C:\Users\qinyi\.local\bin\claude.exe，agent-detector 实际解析目标）
