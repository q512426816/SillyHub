---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:48Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:48
---

# sillyhub-daemon · 集成

> 按集成对象分组。所有集成均基于 Node.js/TypeScript 实际源码。

## 1. backend（HTTP + WebSocket，主依赖）

### 1.1 WebSocket（实时控制通道）
- **依赖**：`ws` ^8.18.0
- **封装**：`src/ws-client.ts`（`WsClient`）
- **连接**：`protocol.ts` 定义 `WS_PATH = '/api/daemon/ws'`；`ws-client.ts` `_createSocket` 把 HTTP origin 转 ws/wss（`http://`→`ws://`，`https://`→`wss://`），`CONNECT_TIMEOUT_MS=10s` / `CLOSE_TIMEOUT_MS=5s`。
- **事件**：`open` / `message` / `close` / `error`；`_handleMessage` 解析 JSON 为 `DaemonMessage` 后回调 `onMessage`。
- **内建 RPC**：`_dispatchRpc` 分支处理 RPC 请求/响应（不污染 lease 消息分发），`RpcError`。
- **心跳与重连**：`send(msg)` 在 OPEN 时发 JSON 字符串；`RECONNECT_INTERVAL_MS=5s` / `RECONNECT_MAX_INTERVAL_MS=5s` 自动重连。
- **消息类型**：`task_available` / `SESSION_INJECT` / `SESSION_INTERRUPT` / `SESSION_END` / `PERMISSION_RESPONSE`（`MSG` 常量集中定义于 `protocol.ts`）。

### 1.2 HTTP（lease 生命周期 + REST）
- **依赖**：Node 20 原生 `fetch`（零 HTTP 库）
- **封装**：`src/hub-client.ts`（`HubClient`，无状态瘦客户端）
- **前缀**：`REST_PREFIX = '/api/daemon'`
- **端点**：`claim_lease` / `start_lease` / `lease_heartbeat` / `submit_messages` / `complete_lease` / `getPendingLeases` / `getExecutionContext` / `notifyRunResult` / `notifySessionEnd` 等。
- **约定**：
  - 无连接池，每次请求独立 fetch，`close()` 为 no-op（API 兼容）。
  - body 字段 snake_case（`runtime_id` / `claim_token` / `agent_run_id`）对齐 backend Pydantic 模型。
  - 超时 `AbortSignal.timeout(30_000)`。
  - 非 2xx 抛 `HubHttpError`；网络/超时错误不包装，透传 fetch 原始异常。
  - 不读 HTTP_PROXY（fetch 默认行为，等价 Python 旧实现 `trust_env=False`）。

### 1.3 受限文件 RPC（经 WS 通道）
- **封装**：`src/file-rpc.ts`：经 WS 通道的文件读写 RPC（`listDir` 等），`assertWithinAllowedRoots` 强制校验目标路径在 `allowed_roots` 内，越界抛错；`task-runner.ts` 防 tar 路径穿越。

## 2. Claude Agent SDK（本地 Claude 进程，Agent 执行核心）

- **依赖**：`@anthropic-ai/claude-agent-sdk` 0.3.181（package.json `dependencies`，精确版本非 `^`）
- **封装位置**：`src/interactive/claude-sdk-driver.ts`（`ClaudeSdkDriver`，无状态）
- **用法**：
  - `import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`，导入类型 `Query` / `CanUseTool` 等。
  - `ClaudeSdkDriver.start(input, opts)`：调用 `sdkQuery({ prompt: AsyncIterable, options })` 启动同进程多轮。
  - `options` 按需注入 `canUseTool` / `model` / `allowedTools` / `resume`（字段缺失不写，让 SDK 走默认）。
  - `ClaudeSdkDriver.interrupt(q)`：turn 级中断，调 `q.interrupt()`；q=null 或抛错 → no-op 返回 false。
  - `canUseTool` 回调把 SDK 的 tool 权限请求桥接到 backend `PERMISSION_REQUEST/RESPONSE`（见 `permission-resolver.ts`，`PERMISSION_FALLBACK_TIMEOUT_MS=5min5s`）。
  - `resolveClaudeExecutable`：claude 可执行路径解析，失败抛 `ClaudeExecutableNotFoundError`。
- **平台分发 hack**：package.json `pnpm.overrides` 把 8 个平台 optional package（win32/linux/darwin × x64/arm64，linux 含 musl）统一解析到主包 0.3.181，规避 win32 等平台 native 二进制分发问题。

## 3. CLI（commander）

- **依赖**：`commander` ^12.1.0
- **bin**：`sillyhub-daemon` → `./dist/cli.js`（package.json `bin`）
- **入口**：`src/cli.ts` 的 `createProgram()`（导出为函数，非单例，便于多次 parse argv）
- **命令**：
  - `start`：`--server` / `--token` / `--api-key`（token 与 api-key 互斥）/ `--workspace-dir` / `--poll-interval` / `--heartbeat-interval` / `--max-concurrent` / `--log-level` + terminal observer 组（`--open-terminal` / `--terminal-mode parsed|raw|both` / `--terminal-close-on-exit` / `--terminal-command`）
  - `stop`：向运行中 daemon 发 SIGTERM（读 PID 文件 `~/.sillyhub/daemon/daemon.pid`）
  - `status`：输出 State / PID / Runtime ID / Server URL / Config dir
  - `logs [--tail N]`：查看最后 N 行日志（默认 50，读 `daemon.log`）

## 4. 文件系统（PID / 日志 / 配置 / 会话快照 / workspace）

- **配置目录**：`~/.sillyhub/daemon/`（`config.ts` `DEFAULT_CONFIG_DIR`，Windows 上 `$HOME` 通常是 `C:\Users\<you>`）
  - `config.json`：`start` 选项持久化，下次启动作默认值（`DaemonConfig`）
  - `daemon.pid`：运行中进程 PID（`getPidFile`/`readPid`/`writePid`/`removePid`/`isProcessAlive`）
  - `daemon.log`：全部运行日志（`getLogFile`/`logsAction`）
  - `sessions.json`：交互式会话快照（`JsonSessionPersistence`，`SESSION_FILE_VERSION=1`）
  - `workspaces/`：任务工作区基目录（`WorkspaceManager`，git 操作）
  - 凭证文件：`credential.ts` `DEFAULT_CREDENTIALS_PATH`

## 5. 构建与运行时

- **构建**：`tsc`（`tsconfig.json`：NodeNext + strict + noUncheckedIndexedAccess + verbatimModuleSyntax + declaration + sourceMap，`rootDir=src`，`outDir=dist`）
- **运行**：`node dist/cli.js`（`start` 脚本）
- **开发**：`tsc --watch`（`dev`）；`tsc --noEmit`（`typecheck`）
- **包管理**：pnpm 9.6.0（`packageManager`），`@types/node` 20.14.0，`@types/ws` ^8.5.12
- **测试运行**：`vitest run --passWithNoTests`（`test` 脚本，environment=node）
- **全局链接**：README 指引 `npm link` 让 `sillyhub-daemon` 命令指向本项目（改源码后需 `pnpm build` 重新生成 dist）

## 6. 平台 / 外部工具（按需调用）

- **git**：`workspace.ts` 的 WorkspaceManager 调用 git（spec 拉取/推送、状态），失败抛 `GitError`
- **本机 agent 可执行**：`agent-detector.ts` 的 `AgentDetector` 探测 claude / codex / gemini 等可执行（`PROVIDER_SPECS`）
- **系统终端**：`terminal-launcher.ts` 可选为每个 agent 任务开终端窗口 tail 日志（平台相关）
