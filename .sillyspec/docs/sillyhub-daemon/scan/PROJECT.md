---
source_commit: ba87eec
updated_at: 2026-06-23T16:28:40Z
created_at: 2026-06-24T00:28:40
author: qinyi
generator: sillyspec-scan
---

# sillyhub-daemon · 项目

## 项目简介

`sillyhub-daemon` 是 SillyHub 平台的**本地守护进程**，运行在用户本机。核心职责：

1. **驱动 Claude agent 执行任务**：通过 `@anthropic-ai/claude-agent-sdk`（Claude Agent SDK）在同一进程内启动多轮 `query`，承接 backend 下发的任务并在用户机器上真实执行（编辑代码、跑命令、读文件等）。
2. **与 platform backend 通信**：
   - HTTP（`hub-client.ts`，Node 20 原生 fetch）：claim/start/heartbeat/complete lease 生命周期。
   - WebSocket（`ws-client.ts`，基于 `ws`）：实时接收 `task_available`、`SESSION_INJECT/INTERRUPT/END`、`PERMISSION_RESPONSE` 等控制消息，回传执行状态与输出。
3. **交互式会话管控**：create/active/idle/failed/ended 生命周期、空闲扫描、断线重连与会话恢复、权限解析（`interactive/` 目录，基于 Claude SDK driver）。
4. **可选终端观察**：为每个 agent 任务开一个本地终端窗口 tail 观察日志（`--open-terminal`）。
5. **spec 同步**：tar 打包同步 spec 目录（`spec-sync.ts` + `tests/spec-transport-tar-sync/`）。

入口命令 `sillyhub-daemon`（bin → `./dist/cli.js`），子命令：`start` / `stop` / `status` / `logs`。

**历史**：本项目曾用 Python 3.12 + httpx + websockets + Click 实现，已于 task-21（约 2026-06-14）整体重写为 Node.js/TypeScript。旧的 `sillyhub_daemon/` Python 包目录为历史残留，不再使用；源码中仍保留大量"对齐 Python xxx"映射注释，属于重写期对照说明。

## 技术栈

| 层 | 选型 |
| --- | --- |
| 运行时 | Node.js ≥ 20（ESM，`type:module`） |
| 语言 | TypeScript 5.5.4（strict + noUncheckedIndexedAccess + NodeNext + verbatimModuleSyntax） |
| Agent 执行核心 | `@anthropic-ai/claude-agent-sdk` 0.3.181（Claude Agent SDK，精确钉版） |
| CLI | `commander` ^12.1.0 |
| 传输 | `ws` ^8.18.0（WebSocket） |
| HTTP | Node 20 原生 `fetch`（零额外 HTTP 库） |
| 构建 | `tsc`（`rootDir=src` / `outDir=dist`）+ `@vercel/ncc` ^0.44.0 单文件打包 |
| 包管理 | pnpm 9.6.0 |
| 测试 | `vitest` ^2.0.0 |

## 关键能力

- **多协议 backend 通信**：HTTP lease 生命周期 + WebSocket 实时控制消息双通道。
- **task-runner 任务编排**：provider 分发、重试/超时、终端观察器、流式 JSON 解析、diff 截断、stats 透传（`task-runner.ts` + adapters/）。
- **交互式会话（interactive）**：Claude SDK driver 封装（query 句柄、interrupt、resume、can-use 权限）、session-manager 生命周期、pending 清理、idle 扫描、session-store 持久化、recovery、permission-resolver。
- **agent 检测**：启动时探测本机 12 种 coding agent CLI（claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity），按优先级 `env 覆盖 → PATH which → 不可用`（`agent-detector.ts`）。
- **spec tar 同步**：`spec-sync.ts` 打包同步 spec 目录到 agent 工作区。

## 在 monorepo 中的位置

- 子项目根：`sillyhub-daemon/`（仓库根下，非 `multi-agent-platform/` 子目录）
- 关系：`connects_to` backend（HTTP + WebSocket），由 backend 下发任务、回收状态
- 平台角色：本机任务执行端（agent runner + 会话管控 + lease 生命周期上报 + agent CLI 探测）

## 关键文档

- 架构：`scan/ARCHITECTURE.md`
- 目录结构：`scan/STRUCTURE.md`
- 集成：`scan/INTEGRATIONS.md`
- 约定：`scan/CONVENTIONS.md`
- 测试：`scan/TESTING.md`
- 风险与债务：`scan/CONCERNS.md`
- README：`sillyhub-daemon/README.md`
