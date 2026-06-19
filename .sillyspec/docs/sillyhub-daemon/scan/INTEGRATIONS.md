---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 集成

> 按集成对象分组。所有集成均基于 Node.js/TypeScript 实际源码。

## 1. Claude Agent SDK（Agent 执行核心）

- **依赖**：`@anthropic-ai/claude-agent-sdk` 0.3.181（package.json `dependencies`）
- **封装位置**：`src/interactive/claude-sdk-driver.ts`
- **用法**：
  - `import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`，导入类型 `Query` / `CanUseTool` 等。
  - `ClaudeSdkDriver.start(input, opts)`：调用 `sdkQuery({ prompt: AsyncIterable, options })` 启动同进程多轮（spike H2 签名）。
  - `options` 按需注入 `canUseTool` / `model` / `allowedTools` / `resume`（字段缺失不写，让 SDK 走默认）。
  - `ClaudeSdkDriver.interrupt(q)`：turn 级中断，调 `q.interrupt()`（spike D1：当前 turn 产 `error_during_execution` 但 query 不结束，可续轮）；q=null 或抛错 → no-op 返回 false。
  - `canUseTool` 回调把 SDK 的 tool 权限请求桥接到 backend `PERMISSION_REQUEST/RESPONSE`（见 `permission-resolver.ts`）。
- **平台分发 hack**：package.json `pnpm.overrides` 把 8 个平台 optional package（win32/linux/darwin × x64/arm64，linux 含 musl）统一解析到主包，规避 win32 等平台 native 二进制分发问题。
- **错误**：`ClaudeExecutableNotFoundError`（claude 可执行解析失败）。

## 2. backend（WebSocket + HTTP）

### 2.1 WebSocket（实时通道）
- **依赖**：`ws` ^8.18.0
- **封装**：`src/ws-client.ts`（`WsClient`）
- **连接**：`protocol.ts` 定义 `WS_PATH = '/api/daemon/ws'`，`new WebSocket(url)` 建连。
- **事件**：`open` / `message` / `close` / `error`；`_handleMessage` 解析 JSON 为 `DaemonMessage` 后回调 `onMessage`。
- **内建 RPC**：`_dispatchRpc` 分支处理 RPC 请求/响应（不污染 lease 消息分发），`RpcError`。
- **心跳**：`send(msg)` 在 OPEN 时发 JSON 字符串。

### 2.2 HTTP（lease 生命周期 + REST）
- **依赖**：Node 20 原生 `fetch`（零 HTTP 库）
- **封装**：`src/hub-client.ts`（`HubClient`）
- **前缀**：`REST_PREFIX = '/api/daemon'`
- **端点**：claim_lease / start_lease / lease_heartbeat / submit_messages / complete_lease 等。
- **约定**：
  - 无连接池，每次请求独立 fetch，`close()` 为 no-op（API 兼容）。
  - body 字段 snake_case（runtime_id / claim_token / agent_run_id）对齐 backend Pydantic 模型。
  - 超时 `AbortSignal.timeout(30_000)`。
  - 非 2xx 抛 `HubHttpError`；网络/超时错误不包装，透传 fetch 原始异常。
  - 不读 HTTP_PROXY（fetch 默认行为，等价 Python 旧实现 `trust_env=False`）。

### 2.3 受限文件 RPC
- **封装**：`src/file-rpc.ts`：经 WS 通道的文件读写 RPC，强制校验目标路径在 `allowed_roots` 内，越界抛 `RpcError('forbidden')`，并防 tar 路径穿越（task-runner.ts）。

## 3. CLI（commander）

- **依赖**：`commander` ^12.1.0
- **bin**：`sillyhub-daemon` → `./dist/cli.js`（package.json `bin`）
- **入口**：`src/cli.ts` 的 `createProgram()`（导出为函数，非单例，便于 task-22 多次 parse argv）
- **命令**：
  - `start`：`--server` / `--token` / `--api-key`（token 与 api-key 互斥）/ `--workspace-dir` / `--poll-interval` / `--heartbeat-interval` / `--max-concurrent` / `--log-level` + terminal observer 组（`--open-terminal` / `--terminal-mode parsed|raw|both` / `--terminal-close-on-exit` / `--terminal-command`）
  - `stop`：向运行中 daemon 发 SIGTERM（读 PID 文件）
  - `status`：输出 State / PID / Runtime ID / Server URL / Config dir
  - `logs [--tail N]`：查看最后 N 行日志（默认 50）

## 4. 构建与运行时

- **构建**：`tsc`（`tsconfig.json`：NodeNext + strict + noUncheckedIndexedAccess + verbatimModuleSyntax + declaration + sourceMap，`rootDir=src`，`outDir=dist`）
- **运行**：`node dist/cli.js`（`start` 脚本）
- **开发**：`tsc --watch`（`dev` 脚本）；`tsc --noEmit`（`typecheck` 脚本）
- **包管理**：pnpm 9.6.0（`packageManager`），`@types/node` 20.14.0
- **测试运行**：`vitest run --passWithNoTests`（`test` 脚本，environment=node）
- **全局链接**：README 指引 `npm link` 让 `sillyhub-daemon` 命令指向本项目（改源码后需 `pnpm build` 重新生成 dist）

## 5. 平台 / 外部工具（按需调用）

- **git**：`workspace.ts` 的 WorkspaceManager 调用 git（spec 拉取/推送、状态），失败抛 `GitError`
- **本机 agent 可执行**：`agent-detector.ts` 探测 claude / codex / gemini 等可执行
- **系统终端**：`terminal-launcher.ts` 可选为每个 agent 任务开终端窗口 tail 日志（平台相关）
