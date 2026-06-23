---
source_commit: ba87eec
updated_at: 2026-06-23T16:28:15Z
created_at: 2026-06-24T00:28:15
author: qinyi
generator: sillyspec-scan
---

# sillyhub-daemon · 架构

> 基于实际源码扫描（`sillyhub-daemon/src/` 下 25 个 `.ts` 文件 + `adapters/`、`interactive/` 两个子目录）。该项目原为 Python 实现，task-21 已整体重写为 Node.js/TypeScript，旧 `sillyhub_daemon/` Python 包不再使用。

## 技术栈

- **运行时**：Node.js ≥ 20（ESM，`package.json` 中 `"type": "module"`，`engines.node` 要求 `>=20.0.0`）
- **语言**：TypeScript 5.5.4（`tsconfig.json`：`module/moduleResolution=NodeNext` + `strict`，`rootDir=src`，`outDir=dist`）
- **Agent 执行核心**：`@anthropic-ai/claude-agent-sdk` 0.3.181（Claude Agent SDK，驱动同进程多轮 `query`）
  - `package.json` 通过 pnpm `overrides` 把 8 个平台 optional package（win32/linux/darwin × x64/arm64 × glibc/musl）统一解析到主包 0.3.181，绕开平台 native 依赖分发问题
- **CLI**：`commander` ^12.1.0（bin: `sillyhub-daemon` → `./dist/cli.js`）
- **传输**：`ws` ^8.18.0（WebSocket，daemon → backend 实时通道）
- **HTTP**：Node 20 原生 `fetch`（零 HTTP 库依赖，hub-client.ts 明确采用）
- **包管理**：pnpm 9.6.0（`packageManager` 字段）；无 pnpm 也可用 npm
- **测试**：`vitest` ^2.0.0（`environment=node`，include `tests/**/*.test.ts`）
- **构建**：`tsc`（脚本：`dev`=`tsc --watch` / `build`=`tsc` / `typecheck`=`tsc --noEmit` / `start`=`node dist/cli.js`）；bundle via `@vercel/ncc` ^0.44.0（`bundle` 脚本 = `bash scripts/build-bundle.sh`）

## 架构概览

守护进程以单进程常驻方式运行在用户机器上，对上承接 platform backend（WebSocket + HTTP），对下驱动 Claude agent 执行任务，并向 backend 上报 lease 生命周期与交互式会话状态。

```
                ┌────────────────────────────────────────────────────────────────┐
                │                        sillyhub-daemon                          │
                │                                                                │
  backend ──WS──►  WsClient  ──►  Daemon (主循环/三循环) ──►  SessionManager ──►  ClaudeSdkDriver ──► Claude Agent SDK (query)
   (HTTP)   ◄──HTTP── HubClient ─►     │                              │              (canUseTool / interrupt / resume)
                                    │                              ▼
                                    ├──► TaskRunner (非交互 lease)  ──►  WorkspaceManager / CredentialManager / AgentDetector
                                    │         │   │
                                    │         │   └──► spec-sync (spec bundle pull/push，含 Tar Slip 防护)
                                    │         │
                                    │         └──► adapters (5 协议：stream_json / json_rpc / jsonl / ndjson / text)
                                    │
                                    └──► protocol (MSG 常量 + WS 路径 + lease 状态)
                └────────────────────────────────────────────────────────────────┘
```

### 关键组件（按职责）

- **`src/cli.ts`**：commander 入口，`createProgram()` 导出为函数（非单例）便于多次 parse。命令：`start`（含 `--server/--token/--api-key/--workspace-dir/--poll-interval/--heartbeat-interval/--max-concurrent/--log-level` + terminal observer 选项组 `--open-terminal/--terminal-mode/--terminal-close-on-exit/--terminal-command`）、`stop`、`status`、`logs [--tail N]`。负责 PID 文件读写（`getPidFile`/`readPid`/`isProcessAlive`/`writePid`/`removePid`）、配置加载、构造并启动 `Daemon`。`--version` 由 `DAEMON_VERSION` 提供。
- **`src/daemon.ts`**：核心守护类 `Daemon`。维护三循环（HTTP 轮询 / WS 心跳 / lease 执行），启动时对每条持久化 session 记录调 `recoverSession` + `restoreAndReconnect`（query resume）。路由 `SESSION_INJECT/INTERRUPT/END` 控制消息与 `PERMISSION_RESPONSE` 到 `SessionManager`。定义 `RecoveryCoordinator` / `DaemonOptions` / `InteractiveCredentialManager` 接口。
- **`src/interactive/`**：交互式会话子系统。
  - `claude-sdk-driver.ts`：封装 `@anthropic-ai/claude-agent-sdk` 的 `query({ prompt: AsyncIterable, options })` / `interrupt()` / `canUseTool` / `resume`；无状态（不持 query 句柄）。`canUseTool` 是否注入由 lease metadata `manual_approval` 决定（scan=true 注入人审，chat=false 不注入）。
  - `session-manager.ts`：`SessionManager` 类，会话生命周期（create/active/idle/failed/ended）、空闲扫描、并发 inject、恢复；自定义 `SessionNotFoundError` / `SessionAlreadyExistsError` / `SessionNotActiveError` / `UnsupportedProviderError`。
  - `input-queue.ts`：长生命周期跨 turn 的 AsyncIterable 输入队列（`SessionQueueClosedError` / `SessionQueueDoubleSubscribeError`）。
  - `permission-resolver.ts`：把 SDK 的 tool 权限请求映射为对 backend 的 `PERMISSION_REQUEST/RESPONSE` 往返。
  - `session-store-persistence.ts`：会话快照落盘与启动恢复（`SessionPersistenceError` / `JsonSessionPersistence`，默认写 `~/.sillyhub/daemon/sessions.json`）。
  - `types.ts`：交互式会话相关类型 + 错误类集中定义。
- **`src/task-runner.ts`**：非交互式 lease 任务编排核心（`TaskRunner.runLease`）：claim/start/heartbeat/submitMessages/complete，spawn agent 子进程，`getBackend(provider)`（默认 `claude`）取 adapter 解析输出。导出纯函数 `resolveTimeout` / `resolveMaxRetries` / `isSpawnLevelFailure` / `renderAgentEvent` / `echoAgentEvent` 等。
- **`src/spec-sync.ts`**：spec bundle 双向同步共享 utility（纯函数 + client 参数注入）。从 task-runner 等价迁移：`resolveSpecDir`（`~/.sillyhub/daemon/specs/{wsId}`，wsId 含路径分隔符拒绝）、`pullSpecBundle`（含 404 容错）、`extractTar`（Tar Slip 防护）、`packSpecDir`、`postSpecSync`。设计为纯模块级函数，使 interactive 路径（无 TaskRunner 实例）可直接调用。
- **`src/hub-client.ts`**：`HubClient` 无状态瘦客户端，每次请求独立原生 `fetch`（无连接池）。lease 生命周期 HTTP（claim/start/heartbeat/complete）+ spec sync 上报。非 2xx 抛 `HubHttpError`，body 字段 snake_case 对齐 backend Pydantic，超时 `AbortSignal.timeout(30_000)`。
- **`src/ws-client.ts`**：`WsClient`（基于 `ws`），收发 `DaemonMessage`；内建 RPC 分发（`RpcError`），心跳 `send`，自动重连（`RECONNECT_INTERVAL_MS=5_000` / `RECONNECT_MAX_INTERVAL_MS=5_000` / `CONNECT_TIMEOUT_MS=10_000` / `CLOSE_TIMEOUT_MS=5_000`）。`_createSocket` 抽为 protected 便于测试 stub。
- **`src/adapters/`**：5 协议（stream-json / json-rpc / jsonl / ndjson / text）的协议适配层。`protocol-adapter.ts` 定义统一接口，`index.ts` 维护正向映射 `PROTOCOL_PROVIDERS` 与反查表 `PROVIDER_TO_PROTOCOL`。各 provider 的输出解析（stdout 分帧 / 事件归一化为 `AgentEvent`）在此层完成。
- **`src/config.ts`**：`loadConfig(path?)` 函数式加载 `~/.sillyhub/daemon/config.json`，浅拷贝 `DEFAULT_CONFIG` 起始，规范化 `allowed_roots`，自动生成 `runtime_id`。`DaemonConfig` 接口集中字段定义。
- **辅助模块**：
  - `workspace.ts`（`WorkspaceManager`，git 操作，`GitError`，`MAX_PATCH_CHARS=50_000`）
  - `credential.ts`（`CredentialManager`，凭证占位符 `{{USER_XXX}}` 替换，仅全串匹配）
  - `agent-detector.ts`（`AgentDetector` 探测本机 agent 可执行，`PROVIDER_SPECS`）
  - `daemon-version.ts`（daemon 自身版本号唯一来源，ESM 静态 import package.json 带 `with { type: 'json' }`，供 cli `--version` 与 json-rpc codex 握手 `clientInfo.version`）
  - `version.ts`（外部 agent CLI 的 semver 解析工具，`MIN_VERSIONS` / `checkMinVersion`，区别于 daemon-version）
  - `cursor-version.ts`（Cursor 版本探测）
  - `terminal-launcher.ts` + `terminal-observer.ts`（可选：为每个 agent 任务开本地终端窗口 tail 日志）
  - `spawn-env.ts`（`buildSpawnEnv` / `redactEnv`）
  - `file-rpc.ts`（受限文件读写 RPC，`assertWithinAllowedRoots` 防 `allowed_roots` 越界）
  - `cmd-shim.ts`、`protocol.ts`（MSG 常量 + WS 路径 + lease 状态）、`types.ts`、`index.ts`

## 数据流要点

- **交互式会话**：backend → WS `task_available` → `Daemon` 委托 `SessionManager.create` 建 session + 启动 driver 协程 → `ClaudeSdkDriver.start` 调 SDK `query` → 输入来自 `input-queue`（跨 turn AsyncIterable）→ 输出回传 backend。`SESSION_INJECT/INTERRUPT` 经 `Daemon._routeSessionControl` 入队；`PERMISSION_RESPONSE` 经 `_routePermissionResponse` 路由。会话快照持久化（`JsonSessionPersistence` → sessions.json），启动时 `Daemon` 调 `recoverSession` + `restoreAndReconnect`（query resume）恢复。
- **非交互式 lease**：`Daemon` 三循环之一 → `HubClient` 轮询 → `TaskRunner.runLease` claim → spawn → adapter 解析 → submitMessages → complete。spec bundle 同步走 `spec-sync` 的 `pullSpecBundle`/`postSpecSync`。
- **canUseTool 人审开关**：scan 类任务（lease metadata `manual_approval=true`）注入 `canUseTool` 回调走 backend 人审往返；chat 类（`manual_approval=false`）不注入，工具直接放行。`AskUserQuestion` 走对话回调而非 canUseTool。
