---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:48Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:48
---

# sillyhub-daemon · 目录结构

> 基于 `src/` 下 30 个 `.ts` 源文件 + `tests/` 下 55+ 测试文件的实际结构。

## 顶层结构

```
sillyhub-daemon/
├── src/                      # TypeScript 源码（rootDir）
│   ├── cli.ts                # commander 入口（start/stop/status/logs + PID 管理）
│   ├── daemon.ts             # 守护类 Daemon（三循环 + 会话恢复 + 控制消息路由）
│   ├── hub-client.ts         # HubClient（原生 fetch，lease 生命周期 HTTP）
│   ├── ws-client.ts          # WsClient（基于 ws，DaemonMessage 收发 + RPC + 自动重连）
│   ├── task-runner.ts        # TaskRunner（非交互式 lease 编排核心）
│   ├── config.ts             # loadConfig / DaemonConfig / DEFAULT_CONFIG（~/.sillyhub/daemon/config.json）
│   ├── protocol.ts           # MSG 常量 / WS_PATH / REST_PREFIX / payload 类型
│   ├── types.ts              # DaemonMessage / LeaseCtx / AgentEvent 等公共类型
│   ├── index.ts              # 包导出（占位）
│   ├── version.ts            # SemVer 解析 + checkMinVersion
│   ├── cursor-version.ts     # Cursor 版本解析
│   ├── credential.ts         # 凭证占位符 {{USER_XXX}} 替换（仅全串匹配）
│   ├── workspace.ts          # WorkspaceManager（git，GitError）
│   ├── agent-detector.ts     # AgentDetector（本机 agent 可执行探测，PROVIDER_SPECS）
│   ├── terminal-launcher.ts  # 终端窗口启动（可选）
│   ├── terminal-observer.ts  # 观察日志 tail（可选，NOOP_TERMINAL_OBSERVER）
│   ├── spawn-env.ts          # buildSpawnEnv / redactEnv（子进程环境构造）
│   ├── cmd-shim.ts           # resolveWindowsCmdShim 命令 shim 工具
│   ├── file-rpc.ts           # 受限文件读写 RPC（防 allowed_roots 越界）
│   ├── adapters/             # 协议适配层
│   │   ├── index.ts          # PROTOCOL_PROVIDERS / 反查表 / 启动期断言
│   │   ├── protocol-adapter.ts  # 统一 ProtocolAdapter 接口
│   │   ├── stream-json.ts    # stream_json 协议
│   │   ├── json-rpc.ts       # json_rpc 协议
│   │   ├── jsonl.ts          # jsonl 协议
│   │   ├── ndjson.ts         # ndjson 协议
│   │   └── text.ts           # text 协议
│   └── interactive/          # 交互式会话子系统
│       ├── claude-sdk-driver.ts          # Claude Agent SDK 封装（query/interrupt/canUseTool/resume）
│       ├── session-manager.ts            # SessionManager（生命周期/空闲扫描/恢复）
│       ├── input-queue.ts                # 跨 turn AsyncIterable 输入队列
│       ├── permission-resolver.ts        # tool 权限 ↔ backend REQUEST/RESPONSE
│       ├── session-store-persistence.ts  # JsonSessionPersistence 会话快照落盘与启动恢复
│       └── types.ts                      # 会话类型 + 错误类 + SESSION_FILE_VERSION
├── tests/                    # vitest 测试（environment=node）
│   ├── _sanity.test.ts
│   ├── helpers.ts + helpers/fake-child.ts   # 伪造子进程 / 配置目录隔离
│   ├── fixtures/
│   ├── adapters/             # adapters 单元测试（factory/jsonl/ndjson/protocol-adapter/text/json-rpc）
│   └── interactive/          # 交互式会话测试（16 个，见 TESTING.md）
├── dist/                     # tsc 产物（outDir，git 忽略）
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

## 模块说明（一句话）

- **cli.ts**：commander 程序构造与主入口（`createProgram`/`startAction`/`stopAction`/`statusAction`/`logsAction`）；PID 文件读写（`getPidFile`/`readPid`/`isProcessAlive`/`writePid`/`removePid`）、配置加载、注入 SessionManager + persistence + recoveryClient 后启动 Daemon。
- **daemon.ts**：守护进程核心类 `Daemon`，三循环（heartbeat/poll/lease）+ 会话恢复（recoverSession/restoreAndReconnect）+ 控制消息路由；定义 `RecoveryCoordinator`/`DaemonOptions`/`InteractiveCredentialManager` 接口。
- **hub-client.ts**：基于原生 fetch 的 backend HTTP 瘦客户端（lease 生命周期，`HubHttpError`，无连接池）。
- **ws-client.ts**：基于 ws 的实时通道客户端（`DaemonMessage` 收发 + 内建 RPC 分发 + 自动重连，`RpcError`/`WsState`）。
- **task-runner.ts**：非交互式 lease 任务编排（claim→spawn→adapter→submit→complete，`resolveTimeout`/`resolveMaxRetries`/`isSpawnLevelFailure`）。
- **interactive/**：交互式会话全栈（SDK driver + SessionManager + 输入队列 + 权限解析 + JSON 持久化）。
- **adapters/**：5 协议 × 12 provider 的输出解析层（启动期断言 provider 数=12）。
- **config.ts / protocol.ts / types.ts**：配置、协议常量、公共类型。
- **辅助**：workspace（git）/ credential（占位符）/ agent-detector / terminal-* / spawn-env / cmd-shim / file-rpc / version / cursor-version。
