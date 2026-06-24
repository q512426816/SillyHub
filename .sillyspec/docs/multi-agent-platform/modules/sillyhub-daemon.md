---
schema_version: 1
doc_type: module-card
module_id: sillyhub-daemon
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# sillyhub-daemon

## 定位

运行在用户本机（或工作机）的 Node 守护进程，是平台"触达本地 Agent 运行时"的桥梁。它把本地 Claude Code / Codex 等子进程接入平台：受控启动会话、拦截工具调用做权限审批、把消息流回 backend、维持租约心跳。是 monorepo 中唯一与外部 Agent SDK 直接耦合的组件，依赖 backend 的 daemon/lease 接口，被 deploy 编排、被 frontend 通过 backend 间接驱动。

技术栈：Node.js ≥20、TypeScript 5.5、ESM（`"type":"module"`）、@anthropic-ai/claude-agent-sdk 0.3.181、commander（CLI）、ws（WebSocket）、pnpm 9.6、vitest、@vercel/ncc（打包）。产出可执行 `sillyhub-daemon`（bin 指向 `dist/cli.js`）。

## 契约摘要

- **CLI 入口**：`src/cli.ts` 的 `createProgram()` 用 commander 暴露子命令——start（startAction）、stop（stopAction）、status（statusAction）、logs（logsAction）等；进程管理经 PID 文件（getPidFile/readPid/writePid/removePid/isProcessAlive）与日志文件（getLogFile）。
- **与 backend 通信**：`src/hub-client.ts` 的 `HubClient` 实现 daemon 注册（RegisterBody）、领租约（ClaimLease/StartLease）、心跳（Heartbeat/LeaseHeartbeat）、提交消息（SubmitMessages）、完成租约（CompleteLease）；认证 `HubClientAuth`，错误类型 `HubHttpError`。
- **消息协议**：`src/protocol.ts` 定义 WS 消息集合 `MSG` 与 payload（SessionInject、SessionControl、PermissionRequest/Response 等）。
- **Agent 接入**：`src/adapters/`（json-rpc/jsonl/ndjson/stream-json/text/protocol-adapter）适配多种 Agent 输出流；`src/interactive/`（claude-sdk-driver、session-manager、session-store-persistence、permission-resolver、input-queue）支撑交互式会话。

## 关键逻辑

- **Daemon 核心**：`src/daemon.ts` 的 `Daemon` 类 + `RecoveryCoordinator`（崩溃恢复）+ `InteractiveCredentialManager`（凭据管理）+ `translateSpecRoot`（spec 根映射）；`DaemonOptions` 控制运行参数。
- **本地能力**：agent-detector（探测已装 Agent）、terminal-launcher/observer（终端拉起与观察）、file-rpc（文件操作）、task-runner、spec-sync（规范同步）、spawn-env、credential、config、workspace、ws-client。
- **构建发布**：`tsc` 出 `dist/`，`scripts/build-bundle.sh`（bundle 脚本）用 ncc 打成单文件便于分发；engines 锁 Node ≥20。

## 注意事项

- claude-agent-sdk 跨平台二进制用 pnpm overrides 统一钉版 0.3.181，升级需全平台验证。
- daemon 与 backend 的 session/permission 消息契约双向耦合，改动必须 backend daemon 模块 + frontend runtime-session 组件同步。
- 守护进程生命周期（PID/日志/恢复）跨平台差异大，Windows/macOS/Linux 都要验证。
- **dialog 审批不超时**：`PermissionResolver.register` 对 dialog 请求（`dialogKind` 存在，如 AskUserQuestion）不启 5min 兜底定时器，永久等待用户决策（与 backend `permission_service.py`/`protocol.py` 的 dialog 不超时语义对齐）；超时不再 deny 放行 "Proceed with recommended option"。普通工具审批（无 dialogKind）仍 5min 兜底；signal abort + abortAll 收尾两者都保留。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
