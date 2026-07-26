---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 项目(Project)

## 项目简介

**sillyhub-daemon** 是 SillyHub 平台的**本地任务执行守护进程**。它从平台 backend 拉取任务,在本机调用本地代理(Claude Code / Codex / Copilot 等)执行,再把日志、子代理活动、产物(patch / 文件)和 token 用量回传给 backend。

- **形态**:常驻后台进程,靠 SIGINT/SIGTERM 退出。PID 写入 `~/.sillyhub/daemon/daemon.pid`,日志写入 `~/.sillyhub/daemon/daemon.log`,配置写入 `~/.sillyhub/daemon/config.json`,workspace 基目录在 `~/.sillyhub/daemon/workspaces/`(`~/.sillyhub/daemon/` 在所有平台上展开为 `$HOME/.sillyhub/daemon`)。
- **入口**:`src/cli.ts`(commander 子命令:`start` / `stop` / `status` / `logs`),`pnpm build` 产出 `dist/cli.js`,经 `npm link` 全局暴露 `sillyhub-daemon` 命令。
- **历史**:当前实现是 **Node.js / TypeScript**(task-21 从 Python 3.12 + httpx + websockets + Click 整体重写),旧 `sillyhub_daemon/` Python 包目录是历史残留,不再使用(README 安装小节要求 `pip uninstall` 清理旧 entry point)。
- **接入方式**:登录平台 → `/runtimes` 页面 → 点"复制命令",得到一条带 `--server` + `--token` 的启动命令贴到本机终端运行。
- **核心职责**:
  1. HTTP 轮询 backend 拉任务(`hub-client.ts`,Node 20 原生 fetch)+ WebSocket 心跳维持在线(`ws-client.ts`,基于 `ws`),双通道收 `task_available` / `SESSION_INJECT/INTERRUPT/END` / `PERMISSION_RESPONSE` 等控制消息。
  2. lease/batch 任务执行 + 交互式会话(interactive)两类调度(`task-runner.ts` / `interactive/session-manager.ts`)。
  3. 多 provider 适配:启动时探测 12 个本机 agent CLI(claude/codex/copilot/opencode/openclaw/hermes/gemini/pi/cursor/kimi/kiro/antigravity)+ 6 种协议适配器(`agent-detector.ts` / `adapters/`)。
  4. 凭证注入、workspace 管理、spec 同步(tar 打包 pull/push)、MCP server、文件系统权限策略、网络韧性 outbox、可选终端观察(`--open-terminal`)。
- **跨平台**:兼容 Windows / Linux / macOS(CLAUDE.md 规则 13);Windows 下 `daemon-start.bat` 需 CRLF,`rmtreeWindowsSafe` 有意同步设计(规避 Node v26 `fs.promises.rm` 在 vitest 的 rimraf callback 竞态)。

## 技术栈

| 维度 | 选型 | 备注 |
| --- | --- | --- |
| 运行时 | Node.js ≥ 20 | `engines.node`,ESM(`"type": "module"`) |
| 语言 | TypeScript 5.5.4 | `strict` + `noUncheckedIndexedAccess` + `NodeNext` + `verbatimModuleSyntax` |
| 包管理 | pnpm 9.6.0 | `packageManager` 钉死;无 pnpm 可降级 npm |
| CLI 框架 | commander ^12.1.0 | 子命令分发 |
| HTTP | Node 20 原生 fetch | 零额外 HTTP 库;默认不读代理环境变量 |
| WebSocket | ws ^8.18.0 | 平台心跳 / session control 下行 |
| Schema 校验 | zod ^4.4.3 | zod v4(API 与 v3 不兼容) |
| YAML | js-yaml ^4.1.0 | 配置 / spec 文件 |
| Claude SDK | @anthropic-ai/claude-agent-sdk 0.3.181 | 钉死,8 条 pnpm overrides 收口平台包子包 |
| MCP | @modelcontextprotocol/sdk ^1.29.0 | daemon 内置 MCP server |
| 打包 | @vercel/ncc ^0.44.0 | 单文件 bundle `dist/cli.js`(self-update 用) |
| 构建 | tsc 5.5.4 | `rootDir=src` / `outDir=dist` |
| 类型生成 | openapi-typescript ^7.13.0 | 从 backend OpenAPI 生成 `src/api-types.ts`(`pnpm gen:types`) |
| 测试 | vitest ^2.0.0 | 两套 config(主 + spikes),详见 TESTING.md |

**关键脚本**:`pnpm dev`(tsc --watch)/ `pnpm build` / `pnpm typecheck` / `pnpm test` / `pnpm bundle` / `pnpm gen:types`。

## 源码组织(src/)

- **顶层**:`cli.ts`(入口)、`daemon.ts`(主循环)、`hub-client.ts` + `ws-client.ts`(平台通信)、`task-runner.ts`(batch lease 执行)、`workspace.ts`、`credential.ts` + `credential-injector.ts`、`agent-detector.ts`、`config.ts` / `version.ts` / `build-id.ts` / `daemon-version.ts` / `cursor-version.ts`、`spec-sync.ts`、`skill-manager.ts`、`mcp-server.ts` + `mcp-config.ts`、`file-rpc.ts` + `roots-rpc.ts`、`preflight.ts`、`runtime-lock.ts`、`protocol.ts`、`types.ts`、`tool-kind.ts`、`permission-rules.ts`、`spawn-env.ts`、`terminal-launcher.ts` + `terminal-observer.ts`、`cmd-shim.ts`、`host-fs-handler.ts`。
- **`adapters/`**:6 协议适配器(stream-json / json-rpc / jsonl / ndjson / pi-json / text)+ `protocol-adapter.ts` 工厂 + `index.ts`。
- **`interactive/`**:交互式会话(`driver.ts` / `claude-sdk-driver.ts` / `codex-app-server-driver.ts` / `session-manager.ts` / `session-store-persistence.ts` / `permission-resolver.ts` / `input-queue.ts` / `types.ts`)。
- **`resilience/`**:网络韧性(`service.ts` outbox 调度 + `error-classify.ts` + `outbox.ts`)。
- **`policy/`**:文件系统权限策略(`filesystem-policy.ts` / `runtime-policy.ts` / `path-utils.ts` / `shell-paths.ts` / `audit-sink.ts`)。

## 在 monorepo 中的位置

- 子项目根:`sillyhub-daemon/`(仓库根下,非 `multi-agent-platform/` 子目录)。
- 关系:`connects_to` backend(HTTP + WebSocket),由 backend 下发任务、回收状态;本机任务执行端(agent runner + 会话管控 + lease 生命周期上报 + agent CLI 探测)。
