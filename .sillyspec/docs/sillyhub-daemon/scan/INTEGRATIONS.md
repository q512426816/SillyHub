---
source_commit: ba87eec
updated_at: 2026-06-23T16:28:30Z
created_at: 2026-06-24T00:28:30
author: qinyi
generator: sillyspec-scan
---

# sillyhub-daemon · 集成

> 按集成对象分组。所有集成均基于 sillyhub-daemon/src 实际源码（ba87eec）。

## 1. backend（HTTP + WebSocket，主依赖）

### 1.1 WebSocket（实时控制通道）
- **依赖**：`ws` ^8.18.0
- **封装**：`src/ws-client.ts`（`WsClient`）
- **连接**：`protocol.ts` 定义 `WS_PATH = '/api/daemon/ws'`；`ws-client.ts` `_buildWsUrl`/`_createSocket` 把 HTTP origin 转 ws/wss（`http://`→`ws://`，`https://`→`wss://`，其它兜底补 `ws://`）。
- **事件**：底层 `ws.on('open'/'message'/'close'/'error')`；`_handleMessage` 解析 JSON 为 `DaemonMessage` 后回调 `onMessage`；`send` 在 `WebSocket.OPEN` 时发 JSON 字符串。
- **内建 RPC**：`_dispatchRpc` 分支处理 RPC 请求/响应（不污染 lease 消息分发），`RpcError`。
- **重连**：`RECONNECT_INTERVAL_MS=5s` / `RECONNECT_MAX_INTERVAL_MS=5s` 自动重连。
- **消息类型**：`task_available` / `SESSION_INJECT` / `SESSION_INTERRUPT` / `SESSION_END` / `PERMISSION_RESPONSE`（`MSG` 常量集中定义于 `protocol.ts`，`MsgType` 联合类型）。

### 1.2 HTTP（lease 生命周期 + 注册/恢复/spec 同步，REST）
- **依赖**：Node 20 原生 `fetch`（零 HTTP 库）
- **封装**：`src/hub-client.ts`（`HubClient`，无状态瘦客户端）
- **前缀**：`REST_PREFIX = '/api/daemon'`
- **端点（方法名）**：`register` / `heartbeat` / `markOffline` / `claimLease` / `startLease` / `leaseHeartbeat` / `submitMessages` / `completeLease` / `getPendingLeases` / `syncStatus` / `notifyRunResult` / `notifySessionEnd` / `recoverSession` / `confirmReconnected` / `markRecoveryFailed` / `getExecutionContext` / `getSpecBundle` / `postSpecSync`。
- **约定**：
  - 无连接池，每次请求独立 fetch，`close()` 为 no-op（API 兼容）。
  - body 字段 snake_case（`runtime_id` / `claim_token` / `agent_run_id`）对齐 backend Pydantic 模型。
  - 超时 `AbortSignal.timeout(30_000)`。
  - 非 2xx 抛 `HubHttpError`；网络/超时错误不包装，透传 fetch 原始异常。
  - 不读 HTTP_PROXY（fetch 默认行为，等价 Python 旧实现 `trust_env=False`）。

### 1.3 受限文件 RPC（经 WS 通道）
- **封装**：`src/file-rpc.ts`：经 WS 通道的文件读写 RPC（`listDir` 等），`assertWithinAllowedRoots` 强制校验目标路径在 `allowed_roots` 内，越界抛错；`task-runner.ts` 防 tar 路径穿越。

## 2. Claude Agent SDK（同进程 Claude 执行，交互式会话核心）

- **依赖**：`@anthropic-ai/claude-agent-sdk` 0.3.181（package.json `dependencies`，精确版本非 `^`）
- **封装位置**：`src/interactive/claude-sdk-driver.ts`（`ClaudeSdkDriver`，无状态）
- **用法**：
  - `import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`，并导入类型 `Query` / `CanUseTool` 等。
  - `ClaudeSdkDriver.start(input, opts)`：先 `resolveClaudeExecutable(opts.pathToClaudeCodeExecutable)` 把 wrapper 路径转成真可执行，再调 `sdkQuery({ prompt: AsyncIterable, options })` 启动同进程多轮。
  - `options` 按需注入 `canUseTool` / `model` / `allowedTools` / `resume`（字段缺失不写，让 SDK 走默认）。
  - `ClaudeSdkDriver.interrupt(q)`：turn 级中断，调 `q.interrupt()`；q=null 或抛错 → no-op 返回 false。
  - `canUseTool` 回调把 SDK 的 tool 权限请求桥接到 backend `PERMISSION_REQUEST/RESPONSE`（见 `permission-resolver.ts`）。
  - `resolveClaudeExecutable`：claude 可执行路径解析，失败抛 `ClaudeExecutableNotFoundError`。
- **平台分发 hack**：package.json `pnpm.overrides` 把 8 个平台 optional package（win32/linux/darwin × x64/arm64，linux 含 musl）统一解析到主包 0.3.181，规避各平台 native 二进制分发问题。

## 3. 本地 coding agent CLI（子进程 spawn，非交互式 lease 核心）

- **依赖**：Node 原生 `node:child_process`（`spawn`）+ `node:readline` 流式采集
- **编排**：`src/task-runner.ts`（`TaskRunner`），流程 claim → 准备 workDir/写 `.claude/CLAUDE.md` → `buildSpawnEnv` 构造 env → `getBackend(provider)` 取 adapter → `spawn(cmdPath, adapter.buildArgs(), { cwd, env })` → 流式解析 → submit → complete。
- **provider 默认 claude**：`ctx.provider ?? 'claude'`（对齐 Python `DEFAULT_PROVIDER`）。
- **spawn 失败重试**：timeout / spawn ENOENT / OOM / segfault / killed 可重试（`isSpawn-levelFailure` + `resolveMaxRetries`），业务 is_error 不重试。
- **探测**：`src/agent-detector.ts`（`AgentDetector`）启动期探测本机 12 种 CLI：claude / codex / copilot / opencode / openclaw / hermes / gemini / pi / cursor / kimi / kiro / antigravity；按优先级 `env 覆盖 → PATH which → 不可用`。
- **版本校验**：`version.ts` 解析各 CLI `--version` 输出（claude/codex/copilot 有最低版本 `MIN_VERSIONS`），`daemon-version.ts` 提供 daemon 自身版本号。
- **凭证注入**：`credential.ts` 替换 `{{USER_XXX}}` 占位符；`spawn-env.ts` 三层合并 env（tool_config.env > claude token > process.env 兜底）。

## 4. CLI（commander）

- **依赖**：`commander` ^12.1.0
- **bin**：`sillyhub-daemon` → `./dist/cli.js`（package.json `bin`）
- **入口**：`src/cli.ts` 的 `createProgram()`（导出为函数，非单例，便于多次 parse argv）
- **命令**：
  - `start`：`--server` / `--token` / `--api-key`（token 与 api-key 互斥）/ `--workspace-dir` / `--poll-interval` / `--heartbeat-interval` / `--max-concurrent` / `--log-level` + terminal observer 组（`--open-terminal` / `--terminal-mode parsed|raw|both` / `--terminal-close-on-exit` / `--terminal-command`）
  - `stop`：向运行中 daemon 发 SIGTERM（读 PID 文件 `~/.sillyhub/daemon/daemon.pid`）
  - `status`：输出 State / PID / Runtime ID / Server URL / Config dir
  - `logs [--tail N]`：查看最后 N 行日志（默认 50，读 `daemon.log`）

## 5. 跨平台打包（单文件 bundle 分发）

- **依赖**：`@vercel/ncc` ^0.44.0（devDependency）
- **脚本**：`scripts/build-bundle.sh` —— 三步：① `tsc` 编译 src→dist（ESM + .d.ts）；② `pnpm exec ncc build dist/cli.js -o build/bundle --no-source-map-register` 把 dist/cli.js 及依赖（含 claude-agent-sdk 原生包）内联成 `build/bundle/index.js`（单文件，零依赖，仅依赖 node runtime）；③ 复制为 `build/bundle/sillyhub-daemon.js`（install.sh 下载此文件名）。
- **安装**：`scripts/install.sh` 一键下载/安装发布 bundle。
- **配合 pnpm.overrides**：打包前 pnpm 用 overrides 把 8 平台 optional package 都解析到主包，ncc 才能把 native 二进制一并内联。

## 6. 文件系统（PID / 日志 / 配置 / 会话快照 / workspace / spec）

- **配置目录**：`~/.sillyhub/daemon/`（`config.ts` `DEFAULT_CONFIG_DIR`）
  - `config.json`：`start` 选项持久化，下次启动作默认值（`DaemonConfig`）
  - `daemon.pid`：运行中进程 PID（`getPidFile`/`readPid`/`writePid`/`removePid`/`isProcessAlive`）
  - `daemon.log`：全部运行日志（`getLogFile`/`logsAction`）
  - `sessions.json`：交互式会话快照（`JsonSessionPersistence`，`SESSION_FILE_VERSION=1`）
  - `workspaces/`：任务工作区基目录（`WorkspaceManager`，git 操作）
  - 凭证文件：`credential.ts` `DEFAULT_CREDENTIALS_PATH`
- **spec 同步**：`spec-sync.ts`（`getSpecBundle` 拉 tar / `postSpecSync` 推）+ `workspace.ts` 的 WorkspaceManager 调用 git（spec 拉取/推送、状态），失败抛 `GitError`。

## 7. 构建/运行/测试

- **构建**：`tsc`（`tsconfig.json`：NodeNext + strict + noUncheckedIndexedAccess + verbatimModuleSyntax + declaration + sourceMap，`rootDir=src`，`outDir=dist`）
- **运行**：`node dist/cli.js`（`start` 脚本）
- **开发**：`tsc --watch`（`dev`）；`tsc --noEmit`（`typecheck`）
- **包管理**：pnpm 9.6.0（`packageManager`，`engines.node >=20.0.0`），`@types/node` 20.14.0，`@types/ws` ^8.5.12
- **测试运行**：`vitest run --passWithNoTests`（`test` 脚本，environment=node）；`vitest`（`test:watch`）
- **打包**：`pnpm bundle` = `bash scripts/build-bundle.sh`

## 8. 平台 / 外部工具（按需调用）

- **git**：`workspace.ts` 的 WorkspaceManager 调用 git（spec 拉取/推送、状态），失败抛 `GitError`
- **本机 agent 可执行**：`agent-detector.ts` 的 `AgentDetector` 探测 12 种 CLI（见 §3）
- **系统终端**：`terminal-launcher.ts` 可选为每个 agent 任务开终端窗口 tail 日志（平台相关）
