---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 架构

> 本文档基于 Node.js/TypeScript 实际源码重写（src/ 下 30 个 `.ts` 文件）。历史上该项目曾是 Python 实现，已在 task-21 整体重写为 TS，旧的 `sillyhub_daemon/` Python 包目录不再使用。下文不再描述 Python 技术栈。

## 技术栈

- **运行时**：Node.js ≥ 20（ESM，`package.json` 中 `"type": "module"`，`engines.node` 要求 ≥20）
- **语言**：TypeScript（`tsconfig.json`：`module=NodeNext` / `moduleResolution=NodeNext` / `strict` + `noUncheckedIndexedAccess` / `verbatimModuleSyntax` / `declaration` + `sourceMap`，`rootDir=src`，`outDir=dist`）
- **Agent 执行核心**：`@anthropic-ai/claude-agent-sdk` 0.3.181（Claude Agent SDK，驱动 Claude agent 同进程多轮 query）
  - `package.json` 使用 pnpm `overrides` 把各平台 optional package（win32/linux/darwin × x64/arm64 × glibc/musl）统一解析到主包 0.3.181，绕开平台 native 依赖分发问题
- **CLI**：`commander` ^12.1.0（bin: `sillyhub-daemon` → `./dist/cli.js`）
- **传输**：`ws` ^8.18.0（WebSocket，daemon → backend 实时通道）
- **HTTP**：Node 20 原生 `fetch`（零 HTTP 库依赖，hub-client.ts 明确采用）
- **包管理**：pnpm 9.6.0（`packageManager` 字段）；无 pnpm 也可 npm
- **测试**：`vitest` ^2.0.0（`environment=node`，include `tests/**/*.test.ts`）
- **构建**：`tsc`（脚本：`dev`=`tsc --watch` / `build`=`tsc` / `typecheck`=`tsc --noEmit` / `start`=`node dist/cli.js`）

## 架构概览

守护进程以单进程常驻方式运行在用户机器上，对上承接 platform backend（WebSocket + HTTP），对下驱动 Claude agent 执行任务，并向 backend 上报 lease 生命周期与交互式会话状态。

```
                ┌────────────────────────────────────────────────────────────┐
                │                     sillyhub-daemon                        │
                │                                                            │
  backend ──WS──►  ws-client  ──►  Daemon (主循环 / 三循环) ──►  SessionManager  ──►  claude-sdk-driver ──► Claude Agent SDK (query)
   (HTTP)   ◄──HTTP── hub-client ─►   │                                       │     (interactive/...)           (canUseTool / interrupt / resume)
                                     │                                       ▼
                                     ├──► TaskRunner (非交互式 lease 编排)  ──► WorkspaceManager / CredentialManager / agent-detector
                                     │         │
                                     │         └──► adapters (5 协议 × 12 provider 解析：stream_json / json_rpc / jsonl / ndjson / text)
                                     │
                                     └──► protocol (MSG 常量 + WS_PATH=/api/daemon/ws + REST_PREFIX=/api/daemon)
                └────────────────────────────────────────────────────────────┘
```

### 关键组件（按职责）

- **`src/cli.ts`**：commander 入口，`createProgram()` 导出为函数（非单例）便于多次 parse。命令：`start`（含 `--server/--token/--api-key/--workspace-dir/--poll-interval/--heartbeat-interval/--max-concurrent/--log-level` + terminal observer 选项组 `--open-terminal/--terminal-mode/--terminal-close-on-exit/--terminal-command`）、`stop`、`status`、`logs [--tail N]`。负责 PID 文件读写、配置加载、构造并启动 `Daemon`。
- **`src/daemon.ts`**：核心守护类 `Daemon`。维护三循环（HTTP 轮询 / WS 心跳 / lease 执行），启动时对每条持久化 session 记录调 `recoverSession` + `restoreAndReconnect`（query resume）。路由 `SESSION_INJECT/INTERRUPT/END` 控制消息与 `PERMISSION_RESPONSE` 到 `SessionManager`。定义 `RecoveryCoordinator` / `DaemonOptions` 接口。
- **`src/interactive/`**：交互式会话子系统（最近 `daemon-interactive-session` 变更的主体）。
  - `claude-sdk-driver.ts`：封装 `@anthropic-ai/claude-agent-sdk` 的 `query({ prompt: AsyncIterable, options })` / `interrupt()` / `canUseTool` / `resume`；无状态（不持 query 句柄）。自定义 `ClaudeExecutableNotFoundError`。
  - `session-manager.ts`：`SessionManager` 类，会话生命周期（create/active/idle/failed/ended）、空闲扫描、并发 inject、恢复；自定义 `SessionNotFoundError` / `SessionAlreadyExistsError` / `SessionNotActiveError` / `UnsupportedProviderError`。
  - `input-queue.ts`：长生命周期跨 turn 的 AsyncIterable 输入队列（`SessionQueueClosedError` / `SessionQueueDoubleSubscribeError`）。
  - `permission-resolver.ts`：把 SDK 的 tool 权限请求映射为对 backend 的 `PERMISSION_REQUEST/RESPONSE` 往返。
  - `session-store-persistence.ts`：会话快照落盘与启动恢复（`SessionPersistenceError`）。
  - `types.ts`：交互式会话相关类型 + 错误类集中定义。
- **`src/task-runner.ts`**：非交互式 lease 任务编排核心（`TaskRunner.runLease`）：claim/start/heartbeat/submitMessages/complete，spawn agent 子进程，`getBackend(provider)`（默认 `claude`）取 adapter 解析输出。防 tar 路径穿越。
- **`src/hub-client.ts`**：`HubClient` 无状态瘦客户端，每次请求独立原生 `fetch`（无连接池，`close()` 为 no-op）。lease 生命周期 HTTP（claim/start/heartbeat/complete）。非 2xx 抛 `HubHttpError`，body 字段 snake_case 对齐 backend Pydantic，超时 `AbortSignal.timeout(30_000)`。
- **`src/ws-client.ts`**：`WsClient`（基于 `ws`），收发 `DaemonMessage`；内建 RPC 分发（`RpcError`），心跳 `send`。`_createSocket` 抽为 protected 便于测试 stub。
- **`src/adapters/`**：5 协议（stream_json / json_rpc / jsonl / ndjson / text）× 12 provider 的协议适配层。`index.ts` 维护正向映射 `PROTOCOL_PROVIDERS` 与反查表 `PROVIDER_TO_PROTOCOL`，启动期断言 provider 数=12 且无重复。各协议实现：`stream-json.ts` / `json-rpc.ts` / `jsonl.ts` / `ndjson.ts` / `text.ts`，统一实现 `protocol-adapter.ts` 接口。
- **`src/config.ts`**：`loadConfig(path?)` 函数式加载 `~/.sillyhub/daemon/config.json`，浅拷贝 `DEFAULT_CONFIG` 起始，规范化 `allowed_roots`，自动生成 `runtime_id`。`DaemonConfig` 接口集中字段定义。
- **辅助模块**：`workspace.ts`（WorkspaceManager，git 操作 `GitError`）、`credential.ts`（凭证占位符 `{{USER_XXX}}` 替换，仅全串匹配）、`agent-detector.ts`（探测本机 agent 可执行）、`terminal-launcher.ts` + `terminal-observer.ts`（可选：为每个 agent 任务开本地终端窗口 tail 日志）、`spawn-env.ts`、`cmd-shim.ts`、`file-rpc.ts`（受限文件读写 RPC，防 `allowed_roots` 越界）、`version.ts`、`protocol.ts`、`types.ts`、`index.ts`。

## 数据流要点

- **交互式会话**：backend → WS `task_available` → `Daemon` 委托 `SessionManager.create` 建 session + 启动 driver 协程 → `ClaudeSdkDriver.start` 调 SDK `query` → 输入来自 `input-queue`（跨 turn AsyncIterable）→ 输出回传 backend。`SESSION_INJECT/INTERRUPT` 经 `Daemon._routeSessionControl` 入队；`PERMISSION_RESPONSE` 经 `_routePermissionResponse` 路由。会话快照持久化，启动时恢复。
- **非交互式 lease**：`Daemon` 三循环之一 → `HubClient` 轮询 → `TaskRunner.runLease` claim → spawn → adapter 解析 → submitMessages → complete。
