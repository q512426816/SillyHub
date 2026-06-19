---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 项目

## 项目简介

`sillyhub-daemon` 是 SillyHub 平台的**本地守护进程**，运行在用户本机。核心职责：

1. **驱动 Claude agent 执行任务**：通过 `@anthropic-ai/claude-agent-sdk`（Claude Agent SDK）在同一进程内启动多轮 `query`，承接 backend 下发的任务并在用户机器上真实执行（编辑代码、跑命令、读文件等）。
2. **与 platform backend 通信**：
   - HTTP（`hub-client.ts`，原生 fetch）：claim/start/heartbeat/complete lease 生命周期。
   - WebSocket（`ws-client.ts`，基于 `ws`）：实时接收 `task_available`、`SESSION_INJECT/INTERRUPT/END`、`PERMISSION_RESPONSE` 等控制消息，回传执行状态与输出。
3. **上报执行状态**：lease 状态机、交互式会话生命周期（create/active/idle/failed/ended）、空闲扫描、断线重连与会话恢复。
4. **可选终端观察**：为每个 agent 任务开一个本地终端窗口 tail 观察日志（`--open-terminal`）。

入口命令 `sillyhub-daemon`（bin → `./dist/cli.js`），子命令：`start` / `stop` / `status` / `logs`。

## 技术栈

- **运行时**：Node.js ≥ 20（ESM）
- **语言**：TypeScript（strict + noUncheckedIndexedAccess + NodeNext + verbatimModuleSyntax）
- **Agent 执行核心**：`@anthropic-ai/claude-agent-sdk` 0.3.181（Claude Agent SDK）
- **CLI**：`commander` ^12.1.0
- **传输**：`ws` ^8.18.0（WebSocket）
- **HTTP**：Node 20 原生 `fetch`（零额外 HTTP 库）
- **包管理**：pnpm 9.6.0
- **测试**：`vitest` ^2.0.0
- **构建**：`tsc`（`rootDir=src` / `outDir=dist`）

> 历史说明：本项目曾用 Python 3.12 + httpx + websockets + Click 实现，已于 task-21 整体重写为 Node.js/TypeScript。旧的 `sillyhub_daemon/` Python 包目录为历史残留，不再使用。

## 在 monorepo 中的位置

- 子项目根：`multi-agent-platform/sillyhub-daemon/`
- 关系：`connects_to` backend（HTTP + WebSocket），由 backend 下发任务、回收状态
- 平台角色：本机任务执行端（agent runner + 会话管控 + lease 生命周期上报）

## 关键文档

- 架构：`scan/ARCHITECTURE.md`
- 目录结构：`scan/STRUCTURE.md`
- 集成：`scan/INTEGRATIONS.md`
- 约定：`scan/CONVENTIONS.md`
- 测试：`scan/TESTING.md`
- 风险与债务：`scan/CONCERNS.md`
- README：`sillyhub-daemon/README.md`
