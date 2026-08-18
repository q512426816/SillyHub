---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 项目（Project）

## 项目简介

**sillyhub-daemon** 是 SillyHub 平台的执行侧守护进程（Node.js CLI）。它通过 HTTP + WebSocket 连接平台 backend，认领平台派发的任务（lease claim / 交互式会话两类调度），在本机调用本地代理（Claude Code / Codex / Copilot 等，启动时探测 12 个 agent CLI）驱动 SillySpec 流程执行，把日志、子代理活动、产物（patch / 文件）和 token 用量回传 backend，并管理本地终端观察、MCP server 与运行配置。（依据 README.md 首节 + `src/cli.ts` / `src/hub-client.ts` / `src/task-runner.ts` 模块头注释核实。）

- **形态**：常驻后台进程（`sillyhub-daemon start`），SIGINT/SIGTERM 退出；PID 写 `~/.sillyhub/daemon/daemon.pid`，日志写 `daemon.log`，配置写 `config.json`，workspace 基目录在 `~/.sillyhub/daemon/workspaces/`。
- **命令清单**（`src/cli.ts` commander 子命令，L327-372 共 4 个）：`start`（选项 `--server` / `--token` / `--api-key` / `--workspace-dir` / `--poll-interval` / `--heartbeat-interval` / `--max-concurrent` / `--log-level` / `--open-terminal` / `--terminal-mode`）/ `stop` / `status` / `logs`。
- **历史**：当前实现为 Node.js / TypeScript（task-21 从 Python 3.12 整体重写）；README 安装小节要求先 `pip uninstall` 清理旧 Python entry point 残留。
- **跨平台**：兼容 Windows / Linux / macOS；路径统一 node:path（grep 无反斜杠拼接，见 CONCERNS）。

## 技术栈

| 维度 | 选型 | 备注 |
| --- | --- | --- |
| 语言 | TypeScript 5.5.4 | strict + noUncheckedIndexedAccess + NodeNext + verbatimModuleSyntax |
| 运行时 | Node.js ≥ 20（ESM） | `engines.node`；原生 fetch / AbortSignal.timeout |
| 包管理 | pnpm 9.6.0 | `packageManager` 钉死；无 pnpm 可降级 npm |
| CLI 框架 | commander ^12.1.0 | 4 个子命令分发 |
| HTTP | Node 20 原生 fetch | 零额外 HTTP 库；默认不读代理环境变量 |
| WebSocket | ws ^8.18.0 | 心跳 + session control 下行（`ws-client.ts`） |
| Schema 校验 | zod ^4.4.3 | 仅 `mcp-server.ts` 消费 |
| Agent SDK | @anthropic-ai/claude-agent-sdk 0.3.181 | 钉死 + 8 条 pnpm overrides 收口平台包子包 |
| MCP | @modelcontextprotocol/sdk ^1.29.0 | `mcp-server.ts` 内置 MCP server（StdioServerTransport） |
| YAML | js-yaml ^4.1.0 | 配置 / local.yaml 写入 |
| 测试 | vitest ^2.0.0 | 主 + spikes 两套 config，详见 TESTING.md |
| 构建/打包 | tsc（build）/ @vercel/ncc ^0.44.0（bundle） | `dist/` 常规构建；bundle 出单文件 `dist/cli.js` 供 self-update |
| 类型生成 | openapi-typescript ^7.13.0 | 从 backend/openapi.json 生成 `src/api-types.ts` |

## 源码组织（src/）

- **顶层**：`cli.ts`（入口）→ `daemon.ts`（主循环，4047 行）；平台通信 `hub-client.ts`（REST）+ `ws-client.ts`（WS）；执行 `task-runner.ts`（batch lease，3156 行）；支撑模块 `spec-sync.ts`（spec bundle tar pull/push + 增量同步 + sillyspec init 拉起）、`local-yaml-writer.ts`、`workspace.ts`、`credential.ts` + `credential-injector.ts`、`agent-detector.ts`、`skill-manager.ts`、`mcp-server.ts` + `mcp-config.ts`、`file-rpc.ts` + `roots-rpc.ts` + `host-fs-handler.ts`、`permission-rules.ts`、`preflight.ts`、`runtime-lock.ts`、`terminal-launcher.ts` + `terminal-observer.ts`、`claude-settings.ts`、`spawn-env.ts`、`config.ts`、`version.ts`/`build-id.ts`/`daemon-version.ts`/`cursor-version.ts`、`api-types.ts`（生成产物）。
- **`adapters/`**：6 协议适配器（stream-json / json-rpc / jsonl / ndjson / pi-json / text）+ `protocol-adapter.ts` 工厂。
- **`interactive/`**：交互式会话（`session-manager.ts` 3897 行 / `claude-sdk-driver.ts` / `codex-app-server-driver.ts` / `driver.ts` / `session-store-persistence.ts` / `permission-resolver.ts` / `input-queue.ts`）。
- **`resilience/`**：网络韧性 outbox（`service.ts` / `outbox.ts` / `error-classify.ts`）。
- **`policy/`**：文件系统权限策略（`filesystem-policy.ts` / `runtime-policy.ts` / `path-utils.ts` / `shell-paths.ts` / `audit-sink.ts`）。
- **`model-error/`**：模型错误分类。

## 与平台（backend）的边界

- **契约**：daemon 对 backend 的全部 HTTP 端点类型来自 `src/api-types.ts`（openapi-typescript 从 `backend/openapi.json` 生成，`pnpm gen:types:check` 守门），与前端共享同一 OpenAPI 单一契约源，禁止手写。
- **通道**：`hub-client.ts` 走 REST（register / heartbeat / claim / lease 心跳 / submitMessages / complete / spec bundle post 等，Node 20 原生 fetch，timeout=30s）；`ws-client.ts` 走 WS 心跳收 `SESSION_INJECT/INTERRUPT/END`、`PERMISSION_RESPONSE` 等下行控制；WS 断线时 HTTP 轮询 `getPendingLeases` 兜底。
- **spec 同步**：`spec-sync.ts` 负责 `.sillyspec` 目录 tar 打包 pull/push（含 Tar Slip 防护）与增量同步，并拉起 `sillyspec init`；init claim 时由平台签发的 workspace 级 `shpsync_` token 契约也体现在 api-types.ts（platform_sync 端点）中。
- **位置**：子项目根 `sillyhub-daemon/`，monorepo 仓库根下；`connects_to` backend，是平台的任务执行端（agent runner + 会话管控 + lease 生命周期上报 + agent CLI 探测）。
