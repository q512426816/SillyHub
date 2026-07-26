---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 集成(Integrations)

按集成对象分组。所有集成均基于 `sillyhub-daemon/src` 实际源码与 `package.json` 依赖清单(6e78b29a)。

## 1. AI 运行时

### 1.1 Claude Agent SDK(同进程 Claude 执行,交互式会话核心)
- **依赖**:`@anthropic-ai/claude-agent-sdk` `0.3.181`(package.json `dependencies`,精确版本非 `^`)。
- **封装**:`src/interactive/claude-sdk-driver.ts`(`ClaudeSdkDriver`)。
- **用法**:从 SDK `import { query }`,以 `prompt: AsyncIterable` + `options`(按需注入 `canUseTool` / `model` / `allowedTools` / `resume` / `pathToClaudeCodeExecutable`)启动同进程多轮;`interrupt(q)` 调 `q.interrupt()` 做 turn 级中断;`canUseTool` 回调把 SDK 工具权限请求桥接到 backend PERMISSION_REQUEST/RESPONSE(见 `permission-resolver.ts`)。
- **类型复用**:`interactive/types.ts` 以 `import type` 直接复用 SDK 的 `Query` / `SDKMessage` / `SDKResultMessage`。
- **平台二进制统一**:`package.json` 的 `pnpm.overrides` 把 8 个平台 optional package(win32 / linux / darwin × x64 / arm64,linux 含 musl)统一解析到主包 `@anthropic-ai/claude-agent-sdk@0.3.181`,规避各平台 native 二进制分发问题,ncc 打包时才能一并内联。
- **Anthropic API**:经 SDK 间接调用,daemon 不直接 `fetch` Anthropic 端点。

### 1.2 Codex(并列 provider,子进程)
- **封装**:`src/interactive/codex-app-server-driver.ts`(`CodexAppServerDriver`),与 Claude driver 并列(`InteractiveProvider = 'claude' | 'codex'`)。
- **会话**:`codex` session 的 `agentSessionId` 即 Codex thread id(resume key),`pathToAgentExecutable` 落盘写 codex app-server 可执行路径。

### 1.3 本地 coding agent CLI(非交互式 lease 核心)
- **编排**:`src/task-runner.ts`(`TaskRunner`),用 Node 原生 `node:child_process` 的 `spawn` + `node:readline` 流式采集;`ctx.provider ?? 'claude'` 默认 claude。
- **探测**:`src/agent-detector.ts`(`AgentDetector`)启动期探测本机多种 CLI(claude / codex / copilot / opencode 等),按 `env 覆盖 → PATH which → 不可用` 优先级。
- **版本校验**:`version.ts` 解析各 CLI `--version` 输出并做最低版本校验;`daemon-version.ts` 提供 daemon 自身版本。

## 2. MCP(Model Context Protocol)

- **依赖**:`@modelcontextprotocol/sdk` `^1.29.0`。
- **服务端**:`src/mcp-server.ts` 用 `McpServer` + `StdioServerTransport` 暴露一个 stdio MCP server(`createMcpServer(client)` / `runMcpServer()`),向 team 主 agent 暴露 daemon 工具;HubClient 作为工具调用的后端通道(测试可传 mock)。
- **客户端注入**:`interactive/claude-sdk-driver.ts` 把 MCP server 列表透传到 SDK 的 `options.mcpServers`,Claude session 走 SDK,codex driver 暂存。
- **配置**:`src/mcp-config.ts` 负责 MCP 配置装配。
- **spikes**:`spikes/06-mcp-server/` 为接入验证原型。

## 3. 与 backend 的通信(HTTP + WebSocket)

### 3.1 WebSocket(实时控制通道)
- **依赖**:`ws` `^8.18.0`。
- **封装**:`src/ws-client.ts`(`WsClient`)。
- **连接**:`protocol.ts` 定义 `WS_PATH`;`ws-client.ts` 把 HTTP origin 转 ws/wss(`http://`→`ws://`、`https://`→`wss://`,其它兜底补 `ws://`),`new WebSocket(url)` 建连;底层 `open/message/close/error` 事件 + 自动重连 + 内建 RPC 分发。
- **消息类型**:`MSG` 常量集中定义于 `protocol.ts`(`task_available` / `SESSION_INJECT` / `SESSION_INTERRUPT` / `SESSION_END` / `PERMISSION_RESPONSE` 等)。

### 3.2 HTTP(lease 生命周期 + 注册/恢复/spec 同步)
- **依赖**:Node 20 原生 `fetch`(零 HTTP 库)。
- **封装**:`src/hub-client.ts`(`HubClient`,无状态瘦客户端)。
- **前缀**:`REST_PREFIX = '/api/daemon'`;另有 5 个端点挂在 agent router(普通 `/api` 前缀,非 `/api/daemon`)。
- **端点示例**:`register` / `heartbeat` / `markOffline` / `claimLease` / `startLease` / `leaseHeartbeat` / `submitMessages` / `completeLease` / `notifyRunResult` / `notifySessionEnd` / `recoverSession` / `confirmReconnected` / `getExecutionContext` / `getSpecBundle` / `postSpecSync` / `dispatch_worker` 等。
- **约定**:body 字段 snake_case 对齐 backend Pydantic;超时 `AbortSignal.timeout(30_000)`;非 2xx 抛 `HubHttpError`;不读 HTTP_PROXY。

### 3.3 受限文件 RPC(经 WS 通道)
- **封装**:`src/file-rpc.ts` 经 WS 通道的文件读写 RPC,`assertWithinAllowedRoots` 强制目标路径在 `allowed_roots` 内,越界抛错;`task-runner.ts` 防 tar 路径穿越。

## 4. CLI(commander)

- **依赖**:`commander` `^12.1.0`。
- **bin**:`sillyhub-daemon` → `./dist/cli.js`(package.json `bin`)。
- **入口**:`src/cli.ts` 的 `createProgram()`(导出为函数,便于多次 parse argv),命令含 `start` / `stop` / `status` / `logs`,以及 `--server` / `--token` / `--workspace-dir` / `--poll-interval` / `--max-concurrent` / `--log-level` 等选项;PID 文件读写(`~/.sillyhub/daemon/daemon.pid`)用于 stop / status。

## 5. 跨平台打包(ncc 单文件 bundle)

- **依赖**:`@vercel/ncc` `^0.44.0`(devDependency)。
- **脚本**:`scripts/build-bundle.sh` —— ① `tsc` 编译 src→dist;② `ncc build dist/cli.js -o build/bundle` 把 dist/cli.js 及依赖(含 claude-agent-sdk 原生包,配合 `pnpm.overrides`)内联成单文件 `build/bundle/sillyhub-daemon.js`(零依赖,仅依赖 node runtime);用于 self-update / 远程升级分发。
- **安装**:`scripts/install.sh`(Linux/macOS)与 `scripts/install.ps1`(Windows)。

## 6. OpenAPI 类型生成

- **依赖**:`openapi-typescript` `^7.13.0`(devDependency)。
- **脚本**:`scripts/gen-api-types.mjs` 从 backend OpenAPI schema 生成 `src/api-types.ts`(`pnpm gen:types` / `pnpm gen:types:check` 校验未漂移)。

## 7. 宿主文件系统操作

- **封装**:`src/host-fs-handler.ts`(宿主 FS 操作处理器)、`src/file-rpc.ts` / `src/roots-rpc.ts`(RPC 实现)。
- **配置目录**:`~/.sillyhub/daemon/`(`config.ts` `DEFAULT_CONFIG_DIR`)下管理 `config.json` / `daemon.pid` / `daemon.log` / `sessions.json` / `workspaces/` / 凭证文件。
- **workspace**:`src/workspace.ts`(`WorkspaceManager`)调用 git 做 spec 拉取/推送与状态(失败抛 `GitError`);`src/spec-sync.ts` 是 spec bundle tar 同步共享 utility。

## 8. npm 依赖总览

- **运行时**:`@anthropic-ai/claude-agent-sdk` 0.3.181、`@modelcontextprotocol/sdk` ^1.29.0、`commander` ^12.1.0、`ws` ^8.18.0、`zod` ^4.4.3、`js-yaml` ^4.1.0。
- **开发**:`@vercel/ncc` ^0.44.0、`openapi-typescript` ^7.13.0、`typescript` 5.5.4、`vitest` ^2.0.0、`@types/node` 20.14.0、`@types/ws` ^8.5.12、`@types/js-yaml` ^4.0.9。
- **包管理 / 运行时**:pnpm 9.6.0(`packageManager`)、Node `>=20.0.0`(`engines`)。
- **zod / js-yaml**:用于 schema 校验与 YAML 配置解析。
