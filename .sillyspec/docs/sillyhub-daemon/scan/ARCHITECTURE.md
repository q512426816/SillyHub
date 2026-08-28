---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 架构（Architecture）

## 技术栈

sillyhub-daemon 是 SillyHub 平台的本地守护进程（Node.js 重写版，原 Python 实现已废弃），跑在开发者/业务人员本机，负责在本地隔离环境驱动 agent（Claude Code / Codex / SillySpec CLI 等）执行任务，并与平台 backend 保持 WebSocket 长连接 + HTTP 双通道协同。包名 `sillyhub-daemon`（private，ESM，`"type": "module"`）。

- **运行时与语言**：Node.js ≥ 20（`engines.node`）；TypeScript 5.5.4，`tsc` 编译（`build`/`dev`/`typecheck` 脚本），产物 `dist/cli.js`；包管理器 pnpm 9.6.0。
- **核心依赖**（package.json dependencies）：
  - `@anthropic-ai/claude-agent-sdk` `0.3.181`（精确版本）—— interactive 链路同进程驱动 Claude Code agent（`query()` 多轮）；pnpm overrides 把全部平台可选依赖（win32/linux/darwin × x64/arm64 × musl/glibc）统一重定向到同版本 npm 包，绕开 native 分发保证跨平台一致。
  - `@modelcontextprotocol/sdk` `^1.29.0` —— 内置 stdio MCP server（`McpServer` + `StdioServerTransport`），向主 agent 注入平台工具。
  - `commander` `^12.1.0` —— CLI 子命令 `start`/`stop`/`status`/`logs`。
  - `ws` `^8.18.0` —— 与 backend 的 WebSocket 长连接。
  - `zod` `^4.4.3` —— 运行时校验。
  - `js-yaml` `^4.1.0` —— YAML 解析。
- **HTTP**：Node 20 原生 `fetch`，零 HTTP 库依赖（`hub-client.ts`）。
- **构建与发布**：`tsc` 常规构建 + `@vercel/ncc` 经 `scripts/build-bundle.sh` 打单文件 bundle；`BUILD_ID`（git SHA）由 `scripts/gen-build-id.mjs` 注入 `src/build-id.ts`，配合 daemon self-update 对齐 backend manifest；`openapi-typescript` 从 backend OpenAPI 生成 `src/api-types.ts`（`gen:types` 脚本，禁止手写）。
- **测试**：`vitest` ^2.0.0（`test` 脚本 `--passWithNoTests`）。

## 架构概览

daemon 是「后端事件驱动 + 本地 agent 执行」的单进程常驻边车：入口 `src/cli.ts` 用 commander 分发子命令，`start` 构造 `Daemon`（`daemon.ts`）主编排——对上承接平台（WebSocket + HTTP），对下 spawn / 同进程驱动 agent，向平台上报 lease 生命周期与交互式会话状态。

```
┌──────────────────────────────────────┐
│      SillyHub 平台 backend（FastAPI） │
└────────▲──────────────────▲──────────┘
         │ WebSocket 长连接  │ HTTP（原生 fetch，每请求 30s 超时）
         │ /api/daemon/ws   │ · daemon 注册 / 心跳 / lease 生命周期
         │ 头 X-API-Key     │ · /api/workspaces/{ws}/spec-workspace/
         │ 30s ping/pong    │   bundle ｜ sync（全量 tar）
         │ 断线 5s 固定重连  │   ｜ sync-incremental（文件级增量）
         │                  │ · missions dispatch_worker / progress 等
┌────────┴──────────────────┴─────────────────────────────────────┐
│           sillyhub-daemon（Node.js ≥20，单进程常驻边车）          │
│                                                                │
│  cli.ts（commander：start / stop / status / logs）               │
│    └─ Daemon（daemon.ts）——纯编排层，三循环：                     │
│         WS 心跳 ｜ HTTP 轮询领 lease ｜ lease 执行                │
│         启动时 _recoverSessionsOnBoot 恢复持久化 interactive 会话  │
│         ├─ TaskRunner（batch/任务链路，spawn 子进程）             │
│         ├─ SessionManager（interactive，同进程多轮 SDK query）    │
│         ├─ 内置 MCP server（stdio，5 个平台工具）                 │
│         └─ spec-sync（spec 树 pull / 增量 push / init lease 编排）│
└────────┬────────────────────────────────────────────────────────┘
         │ spawn（隔离 env：CLAUDE_CONFIG_DIR 重定向 + 凭证注入 +
         │        permissions 写入沙箱 + 内置 MCP server 注入）
         ▼
┌───────────────────────┐   ┌─────────────────────────────────────┐
│ Claude Agent SDK 会话  │   │ 工作区文件系统                        │
│ （同进程 query）或      │──►│ workspace 镜像 + .sillyspec/ 树      │
│ agent / SillySpec CLI │   │ （local.yaml platform 段由 daemon 写）│
│ 子进程                 │   └─────────────────────────────────────┘
└───────────────────────┘
本地状态目录 ~/.sillyhub/daemon/：runtime lock ｜ sessions.json（会话快照）
specs/{ws}/（spec 缓存 + .runtime/spec-version.json）｜ manifests/{ws}.json
（增量清单缓存）｜ runs/{lease}/terminal.log ｜ claude-config/（隔离配置目录）
```

## src/ 一级模块清单（35 个 .ts 文件 + 5 个子目录，共 40 项）

**入口与编排**

- `cli.ts` —— commander 入口，注册 `start`/`stop`/`status`/`logs`，`startAction` 组装并启动 Daemon。
- `daemon.ts` —— `Daemon` 主类（纯编排层）：register → 三循环（心跳/轮询/lease 执行）；路由 WS 控制消息（session 注入/中断/结束/恢复、权限响应、`LEASE_CANCEL`、`SELF_UPDATE`、`PROVIDER_CONFIG_CHANGED` 供应商热切换）；启动时恢复持久化 session（`recoverSession` + `restoreAndReconnect`）。
- `index.ts` —— 源码入口占位（`export {}`，仅为 tsc 有输入）。

**与平台的通道**

- `ws-client.ts` —— WS 客户端：连 `/api/daemon/ws`（query 带 `daemon_local_id`），`X-API-Key` 头；30s ping、pong 超时 terminate→close→重连，重连为固定 5s 间隔（`RECONNECT_INTERVAL_MS`，重连策略在本文件而非 resilience/）。
- `hub-client.ts` —— backend REST 瘦客户端（原生 fetch，每请求独立 + `AbortSignal.timeout(30_000)`）：lease 生命周期（`claimLease`/`startLease`/`heartbeat`/`submitMessages`/`completeLease`/`syncStatus`/`getPendingLeases`）、交互式（`notifyRunResult`/`notifySessionEnd`/`notifySessionReady`）、spec 同步（`getSpecBundle`/`postSpecSync` + sync-incremental）、change write（`claimChangeWrite`/`completeChangeWrite`）、团队（`dispatchWorker`/`getWorkerResult`/`listWorkers`/`convergeMission`/`reportProgress`）、self-update manifest 等。
- `api-types.ts` —— `openapi-typescript` 从 backend OpenAPI 生成（`gen:types`），全项目 HTTP 类型来源，禁止手写。
- `protocol.ts` —— WS 消息常量表 `MSG`（19 个 `daemon:*` 消息：task_available、lease_*、session_*、permission_*、rpc/rpc_result、self_update、lease_cancel、provider_config_changed、heartbeat* 等）+ `WS_PATH = '/api/daemon/ws'`。

**任务执行链**

- `task-runner.ts` —— batch/任务链路执行器：`runLease` 状态机（claim→start→heartbeat→提交消息→complete）、spawn agent 子进程；`kind=spec-sync` 的 lease 分流到 `postSpecSync` 整树/增量回传（不 spawn agent）；init lease 委托 `spec-sync.handleInitLease`。
- `adapters/` —— agent 输出协议适配器（stream-json、json-rpc、jsonl、ndjson、pi-json、text + protocol-adapter/index 归一），统一到内部消息模型。
- `interactive/` —— 同进程多轮会话：`session-manager`（会话生命周期）、`claude-sdk-driver`（Agent SDK `query()`）、`codex-app-server-driver`（Codex provider）、`input-queue`（跨 turn AsyncIterable）、`permission-resolver`（tool 权限 ↔ 平台 `PERMISSION_REQUEST/RESPONSE` 往返）、`session-store-persistence`（`~/.sillyhub/daemon/sessions.json` 快照，支持重启恢复）。
- `model-error/` —— claude 模型调用错误归类器：把 turn 失败信号（is_error/resultText/api_retry/stdout/stderr）归类为 8 类结构化 `ModelError`。
- `mcp-server.ts` —— 内置 stdio MCP server，注册 5 个平台工具：`dispatch_worker`、`get_worker_result`、`list_workers`、`converge_mission`、`report_progress`。
- `mcp-config.ts` —— platform_default 与 daemon 内置 MCP server 的加载/白名单校验/合并，构造 spawn 注入配置。
- `spec-sync.ts` —— spec 树同步核心（纯函数 + client 注入）：`pullSpecBundle`（拉服务器权威 spec 解包到 `~/.sillyhub/daemon/specs/{ws}`）、增量 diff push（本地 hash/清单比对 → `sync-incremental`，base_version 冲突不静默覆盖）、`handleInitLease`（init lease 完整编排：pull → 拉起 `sillyspec init` 子进程（版本门控 `MIN_SILLYSPEC_VERSION_FOR_INIT = '3.26.8'`，同 hash no-op）→ `writeLocalYaml` → 增量回传 → 写 `.runtime/spec-version.json`）；含 Tar Slip 防护与 change_dirs 标注。

**韧性与策略**

- `resilience/` —— 应用层韧性：`outbox`（离线 outbox 落盘防丢）、`error-classify`、`service`（去重编排）。
- `policy/` —— 文件系统访问策略与审计：filesystem-policy、runtime-policy、audit-sink、path-utils、shell-paths。
- `runtime-lock.ts` —— 单实例运行锁（stale/corrupt 可 `start --force` 回收，不强杀活跃进程）。
- `permission-rules.ts` —— 按 `allowed_roots` 生成 CC permissions 写入沙箱规则（读自由/写白名单）。

**环境与凭证**

- `config.ts` —— 配置加载（含 `CLAUDE_CONFIG_DIR` 常量）。
- `credential.ts` / `credential-injector.ts` —— lease 下发凭证读取 + provider-neutral → 各 agent env 字典注入（claude 已实现，预留 codex/gemini/pi）。
- `spawn-env.ts` —— spawn 隔离环境构造（`CLAUDE_CONFIG_DIR` 指向 `~/.sillyhub/.../claude-config`，隔离宿主机 `~/.claude`）。
- `claude-settings.ts` —— 写隔离目录内 `$CLAUDE_CONFIG_DIR/settings.json`（白名单顶层键，不写 env/api_key），让 settings_config 顶层开关生效。
- `local-yaml-writer.ts` —— 文本级 YAML 顶层段替换（复制 sillyspec sync.js 算法），写工作区 `.sillyspec/local.yaml` 的 `platform:`（权威覆盖）/`mcp:` 段。

**文件系统与工作区**

- `workspace.ts` —— 本地 workspace 镜像管理（prepareWorkspace/collectDiff/cleanWorkspace）。
- `file-rpc.ts` / `host-fs-handler.ts` / `roots-rpc.ts` —— 宿主文件系统 RPC 处理（`allowed_roots` 越界防护）。
- `skill-manager.ts` —— workspace skills 同步（对齐 backend skills manifest）。
- `terminal-launcher.ts` / `terminal-observer.ts` —— 可选本地终端观察：每任务写 `runs/{lease}/terminal.log`，跨平台弹独立终端窗口 tail（失败静默不影响任务）。

**辅助与版本**

- `agent-detector.ts` —— 本机 agent 探测（`PROVIDER_SPECS`，供注册与 init lease `--tool` 下发）。
- `preflight.ts` —— 启动前检查 + BUILD_ID。
- `build-id.ts` —— 构建号注入。
- `version.ts` / `cursor-version.ts` / `daemon-version.ts` —— 版本工具（semver 门控、外部 CLI 版本校验）。
- `cmd-shim.ts` —— Windows npm `.cmd` 包装解析（spawn 跨 shell 一致性）。
- `tool-kind.ts` —— 工具分类（与 backend `tool_kind.py` 同逻辑、单测共享，防漂移）。
- `types.ts` —— 共享类型（DaemonMessage/LeaseCtx/LeasePayload/ProviderConfig 等）。

## 与平台的通道

1. **WebSocket**（`ws-client.ts`）：连 `/api/daemon/ws?daemon_local_id=<runtimeId>`，`X-API-Key` 头鉴权（backend 缺头 4001）；30s ping/pong 保活，pong 超时 terminate 触发 close→重连，重连固定 5s 间隔；接收 `task_available` 分派任务、`LEASE_CANCEL` 即时取消 batch 子进程（复用 AbortController→`_killChild`，与心跳轮询双触发幂等）、`PERMISSION_RESPONSE` 权限审批、`PROVIDER_CONFIG_CHANGED` 供应商热切换、`SELF_UPDATE` 自更新指令。
2. **HTTP API client**（`hub-client.ts`）：原生 fetch，无连接池；类型全部来自 `api-types.ts`（`gen:types` 生成物）。
3. **shpsync_ 进度上报（间接通道）**：daemon 自身代码不持有/不直接调用 `shpsync_` token（`shpsync_` 字样仅出现在生成的 `api-types.ts`）；实际路径是 init lease 时 backend 经 lease 下发 `local_yaml: { platform_token, mcp_token }`，daemon 由 `spec-sync.handleInitLease` → `local-yaml-writer.writeLocalYaml` 写进工作区 `.sillyspec/local.yaml` 的 `platform:` 段，随后由 **SillySpec CLI 子进程**用该 token 向平台同步进度（daemon 只负责 provision，不代报）。

## 命令面（cli.ts，commander）

4 个子命令：

- `start` —— 启动 daemon。选项：`--server <url>`、`--token`（短期 Bearer，与 --api-key 互斥）、`--api-key`（长效 X-API-Key）、`--workspace-dir`、`--poll-interval`、`--heartbeat-interval`、`--max-concurrent`、`--log-level`、终端观察组（`--open-terminal`/`--terminal-mode`/`--terminal-close-on-exit`/`--terminal-command`）、`--force`（回收 stale 运行锁）。
- `stop` —— 向运行中 daemon 进程发 SIGTERM。
- `status` —— 显示 daemon 状态。
- `logs` —— 查看日志（`--tail <n>`，默认 50）。

## 生命周期与状态机要点

- **启动**：`startAction` → preflight → `Daemon` register（HTTP，backend 分配 `runtime_id`）→ 三循环起跑；启动时 `_recoverSessionsOnBoot` 对 `sessions.json` 每条持久化记录向 backend `recoverSession` + `restoreAndReconnect`（query resume；恢复≠断点续跑）。
- **batch lease（TaskRunner.runLease）**：WS `task_available` / HTTP 轮询领 lease → `claimLease` → `startLease` → 执行（普通 lease spawn agent 子进程、adapters 解析输出；`kind=spec-sync` 分流 `postSpecSync`；init lease 走 `handleInitLease`：pull → `sillyspec init`（版本门控 ≥3.26.8、backend 同 hash no-op）→ 写 local.yaml → 增量回传）→ `submitMessages` 回写消息/usage → `completeLease`；全程心跳维持，`LEASE_CANCEL` 即时杀子进程。
- **interactive lease（SessionManager）**：同进程 SDK `query()` 多轮；`PERMISSION_REQUEST` 上行审批（5min 未响应 backend 自动 deny）；`SESSION_INJECT/INTERRUPT/END/RESUME` 控制在跑会话；完成走 `notifyRunResult` + `close_interactive_run`（`X-Claim-Token` 校验 + 绑定 session 防跨会话注入）。
- **自更新**：WS `SELF_UPDATE` → `runDaemonSelfUpdate` 下载最新 bundle 替换本地文件（`mcp-server.js` best-effort 伴生替换）→ `daemon.stop()` 释放 runtime lock/标 offline → `respawnDaemonAndExit` 以 detached 子进程拉起新 bundle（原启动参数）→ 退出旧进程（仓库无外部 supervisor，自拉起是唯一重启机制；拉起失败旧进程保活不退出）。
