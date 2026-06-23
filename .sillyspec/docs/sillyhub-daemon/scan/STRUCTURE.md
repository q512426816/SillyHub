---
source_commit: ba87eec
updated_at: 2026-06-23T16:28:30Z
created_at: 2026-06-24T00:28:30
author: qinyi
generator: sillyspec-scan
---

# sillyhub-daemon · 目录结构

> 基于 `src/` 实际目录扫描（ba87eec），ESM TypeScript 工程，rootDir=src，outDir=dist。

## 顶层结构

```
sillyhub-daemon/
├── src/                      # TypeScript 源码（rootDir，24 个 .ts 文件 + 2 子目录）
│   ├── cli.ts                # commander 入口（start/stop/status/logs + PID 管理）
│   ├── daemon.ts             # 守护类 Daemon（三循环 + 会话恢复 + 控制消息路由）
│   ├── hub-client.ts         # HubClient（原生 fetch，lease 生命周期 + 注册/恢复/spec 同步 HTTP）
│   ├── ws-client.ts          # WsClient（基于 ws，DaemonMessage 收发 + RPC + 自动重连）
│   ├── task-runner.ts        # TaskRunner（非交互式 lease 编排核心，spawn 子进程）
│   ├── config.ts             # loadConfig / DaemonConfig / DEFAULT_CONFIG（~/.sillyhub/daemon/config.json）
│   ├── protocol.ts           # MSG 常量 / WS_PATH / REST_PREFIX / payload 类型
│   ├── types.ts              # DaemonMessage / LeaseCtx / AgentEvent 等公共类型
│   ├── index.ts              # 包导出（占位）
│   ├── version.ts            # 外部 agent CLI 的 SemVer 解析 + checkMinVersion（claude/codex/copilot）
│   ├── daemon-version.ts     # daemon 自身版本号唯一来源（读 package.json）
│   ├── cursor-version.ts     # Cursor 版本解析
│   ├── credential.ts         # 凭证占位符 {{USER_XXX}} 替换（仅全串匹配）
│   ├── workspace.ts          # WorkspaceManager（git，GitError）
│   ├── spec-sync.ts          # spec bundle 同步共享 utility（纯函数 + client 注入，D-007@v1）
│   ├── agent-detector.ts     # AgentDetector（12 provider 本机可执行探测：claude/codex/copilot/opencode/...）
│   ├── terminal-launcher.ts  # 终端窗口启动（可选）
│   ├── terminal-observer.ts  # 观察日志 tail（可选，NOOP_TERMINAL_OBSERVER）
│   ├── spawn-env.ts          # buildSpawnEnv / redactEnv（子进程环境构造）
│   ├── cmd-shim.ts           # resolveWindowsCmdShim 命令 shim 工具
│   ├── file-rpc.ts           # 受限文件读写 RPC（防 allowed_roots 越界）
│   ├── adapters/             # 协议适配层（6 文件）
│   │   ├── index.ts          # PROTOCOL_PROVIDERS / provider 反查表 / 启动期断言
│   │   ├── protocol-adapter.ts  # 统一 ProtocolAdapter 接口
│   │   ├── stream-json.ts    # stream_json 协议
│   │   ├── json-rpc.ts       # json_rpc 协议
│   │   ├── jsonl.ts          # jsonl 协议
│   │   ├── ndjson.ts         # ndjson 协议
│   │   └── text.ts           # text 协议
│   └── interactive/          # 交互式会话子系统（6 文件）
│       ├── claude-sdk-driver.ts          # Claude Agent SDK 封装（query/interrupt/canUseTool/resume）
│       ├── session-manager.ts            # SessionManager（生命周期/空闲扫描/恢复）
│       ├── input-queue.ts                # 跨 turn AsyncIterable 输入队列
│       ├── permission-resolver.ts        # tool 权限 ↔ backend REQUEST/RESPONSE
│       ├── session-store-persistence.ts  # JsonSessionPersistence 会话快照落盘与启动恢复
│       └── types.ts                      # 会话类型 + 错误类 + SESSION_FILE_VERSION
├── scripts/                  # 构建与安装脚本
│   ├── build-bundle.sh       # tsc → ncc 打单文件 bundle（build/bundle/sillyhub-daemon.js）
│   └── install.sh            # 一键安装/下载发布 bundle
├── tests/                    # vitest 测试（environment=node）
│   ├── _sanity.test.ts
│   ├── helpers.ts + helpers/fake-child.ts   # 伪造子进程 / 配置目录隔离
│   ├── fixtures/             # 5 协议样例输出（stream-json/json-rpc/jsonl/ndjson/text）
│   ├── adapters/             # adapters 单元测试（factory/jsonl/ndjson/protocol-adapter/text/json-rpc）
│   └── interactive/          # 交互式会话测试（16 个，含 driver/session-manager/recovery/permission）
├── build/                    # ncc bundle 产物（build/bundle/sillyhub-daemon.js，git 忽略）
├── dist/                     # tsc 产物（outDir，git 忽略）
├── package.json              # 依赖：claude-agent-sdk 0.3.181 + commander ^12 + ws ^8；ncc/vitest/typescript devDeps
├── pnpm-lock.yaml
├── tsconfig.json             # NodeNext + strict + declaration + sourceMap
├── vitest.config.ts
└── README.md
```

## 模块说明（一句话）

- **cli.ts**：commander 程序构造与主入口（`createProgram`/`startAction`/`stopAction`/`statusAction`/`logsAction`）；PID 文件读写（`getPidFile`/`readPid`/`isProcessAlive`/`writePid`/`removePid`）、配置加载、注入 SessionManager + persistence + recoveryClient 后启动 Daemon。
- **daemon.ts**：守护进程核心类 `Daemon`，三循环（heartbeat/poll/lease）+ 会话恢复（recoverSession/restoreAndReconnect）+ 控制消息路由；定义 `RecoveryCoordinator`/`DaemonOptions`/`InteractiveCredentialManager` 接口。
- **hub-client.ts**：基于原生 fetch 的 backend HTTP 瘦客户端（lease 生命周期 + 注册/心跳/恢复/spec 同步，`HubHttpError`，无连接池）；方法含 register/heartbeat/markOffline/claimLease/startLease/leaseHeartbeat/submitMessages/completeLease/getPendingLeases/syncStatus/notifyRunResult/notifySessionEnd/recoverSession/confirmReconnected/markRecoveryFailed/getExecutionContext/getSpecBundle/postSpecSync。
- **ws-client.ts**：基于 ws 的实时通道客户端（`DaemonMessage` 收发 + 内建 RPC 分发 + 自动重连，`RpcError`/`WsState`）。
- **task-runner.ts**：非交互式 lease 任务编排（claim→spawn→adapter→submit→complete，`resolveTimeout`/`resolveMaxRetries`/`isSpawn-levelFailure` 重试循环）。
- **interactive/**：交互式会话全栈（SDK driver + SessionManager + 输入队列 + 权限解析 + JSON 持久化）。
- **adapters/**：5 协议（stream_json/json_rpc/jsonl/ndjson/text）× 12 provider 的输出解析层（启动期断言 provider 数=12）。
- **config.ts / protocol.ts / types.ts**：配置、协议常量（`WS_PATH='/api/daemon/ws'`、`REST_PREFIX='/api/daemon'`、`MSG` 类型表）、公共类型。
- **版本双轨**：`version.ts` 解析外部 agent CLI 版本字符串（claude/codex/copilot 最低版本校验），`daemon-version.ts` 读 package.json 提供 daemon 自身版本。
- **辅助**：workspace（git）/ credential（占位符）/ spec-sync（spec bundle tar 同步）/ agent-detector（12 provider 探测）/ terminal-* / spawn-env / cmd-shim / file-rpc / cursor-version。
