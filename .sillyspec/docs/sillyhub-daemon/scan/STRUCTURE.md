---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 目录结构

> 基于 `src/` 下 30 个 `.ts` 源文件 + `tests/` 下 50+ 测试文件的实际结构。

## 顶层结构

```
sillyhub-daemon/
├── src/                      # TypeScript 源码（rootDir）
│   ├── cli.ts                # commander 入口（start/stop/status/logs）
│   ├── daemon.ts             # 守护类 Daemon（三循环 + 会话恢复 + 控制消息路由）
│   ├── hub-client.ts         # HubClient（原生 fetch，lease 生命周期 HTTP）
│   ├── ws-client.ts          # WsClient（基于 ws，DaemonMessage 收发 + RPC）
│   ├── task-runner.ts        # TaskRunner（非交互式 lease 编排核心）
│   ├── config.ts             # loadConfig（~/.sillyhub/daemon/config.json）
│   ├── protocol.ts           # MSG 常量 / WS_PATH / REST_PREFIX / payload 类型
│   ├── types.ts              # DaemonMessage 等公共类型
│   ├── index.ts              # 包导出
│   ├── version.ts            # 版本信息
│   ├── credential.ts         # 凭证占位符 {{USER_XXX}} 替换
│   ├── workspace.ts          # WorkspaceManager（git，GitError）
│   ├── agent-detector.ts     # 本机 agent 可执行探测
│   ├── terminal-launcher.ts  # 终端窗口启动（可选）
│   ├── terminal-observer.ts  # 观察日志 tail（可选）
│   ├── spawn-env.ts          # 子进程环境构造
│   ├── cmd-shim.ts           # 命令 shim 工具
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
│       ├── session-store-persistence.ts  # 会话快照落盘与启动恢复
│       └── types.ts                     # 会话类型 + 错误类
├── tests/                    # vitest 测试（environment=node）
│   ├── _sanity.test.ts
│   ├── cli.test.ts
│   ├── daemon.test.ts
│   ├── daemon-parity.test.ts
│   ├── daemon-multi-runtime.test.ts
│   ├── daemon-kind-dispatch.test.ts
│   ├── daemon-session-lifecycle-wiring.test.ts
│   ├── hub-client.test.ts
│   ├── ws-client.test.ts
│   ├── ws-client-permission-route.test.ts
│   ├── ws-client-session-control.test.ts
│   ├── task-runner.test.ts
│   ├── task-runner-retry-timeout.test.ts
│   ├── task-runner-terminal-observer.test.ts
│   ├── task-runner-provider-dispatch.test.ts
│   ├── protocol.contract.test.ts
│   ├── protocol-session-contract.test.ts
│   ├── config.test.ts
│   ├── workspace.test.ts
│   ├── credential.test.ts
│   ├── spawn-env.test.ts
│   ├── version.test.ts
│   ├── types.test.ts
│   ├── file-rpc.test.ts
│   ├── cmd-shim.test.ts
│   ├── terminal-launcher.test.ts
│   ├── terminal-observer.test.ts
│   ├── agent-detector.test.ts
│   ├── agent-detector.system-claude.integ.test.ts
│   ├── stream-json.test.ts
│   ├── diff-truncate.test.ts
│   ├── stats-passthrough.test.ts
│   ├── execution-context.test.ts
│   ├── task-09-hub-client-spec.test.ts
│   ├── task-09-spec-pull-push.test.ts
│   ├── helpers.ts
│   ├── helpers/fake-child.ts
│   ├── adapters/              # adapters 单元测试
│   │   ├── factory.test.ts
│   │   ├── jsonl.test.ts
│   │   ├── ndjson.test.ts
│   │   ├── protocol-adapter.test.ts
│   │   ├── text.test.ts
│   │   └── json-rpc.test.ts
│   └── interactive/           # 交互式会话测试
│       ├── claude-sdk-driver.test.ts
│       ├── claude-sdk-driver-canuse.test.ts
│       ├── claude-sdk-driver-glm-passthrough.test.ts
│       ├── claude-sdk-driver-permission.test.ts
│       ├── input-queue.test.ts
│       ├── permission-resolver.test.ts
│       ├── session-manager.test.ts
│       ├── session-manager-pending-cleanup.test.ts
│       ├── session-concurrent-inject.test.ts
│       ├── session-idle-scanner.test.ts
│       ├── session-interrupt.test.ts
│       ├── session-recovery.test.ts
│       ├── session-store-persistence.test.ts
│       └── daemon-recovery-boot.test.ts
├── dist/                     # tsc 产物（outDir，git 忽略）
├── package.json
├── pnpm-lock.yaml
├── tsconfig.json
└── README.md
```

## 模块说明（一句话）

- **cli.ts**：commander 程序构造与主入口；PID 文件、配置加载、启动 Daemon。
- **daemon.ts**：守护进程核心类，三循环 + 会话恢复 + 控制消息路由。
- **hub-client.ts**：基于原生 fetch 的 backend HTTP 瘦客户端（lease 生命周期）。
- **ws-client.ts**：基于 ws 的实时通道客户端（DaemonMessage + 内建 RPC）。
- **task-runner.ts**：非交互式 lease 任务编排（claim→spawn→adapter→submit→complete）。
- **interactive/**：交互式会话全栈（SDK driver + 会话管理 + 输入队列 + 权限解析 + 持久化）。
- **adapters/**：5 协议 × 12 provider 的输出解析层。
- **config.ts / protocol.ts / types.ts**：配置、协议常量、公共类型。
- **辅助**：workspace（git）/ credential（占位符）/ agent-detector / terminal-* / spawn-env / cmd-shim / file-rpc / version。
