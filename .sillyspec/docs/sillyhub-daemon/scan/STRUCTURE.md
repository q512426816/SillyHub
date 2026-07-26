---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 目录结构(Structure)

sillyhub-daemon 是 SillyHub 平台的本地守护进程(Node.js / TypeScript 重写版),负责在本机执行 AI 任务、对接 Claude Code / Codex 运行时,并通过 HTTP + WebSocket 与后端通信。ESM 工程,`rootDir=src`、`outDir=dist`,NodeNext + strict。

## 顶层布局

```
sillyhub-daemon/
├── src/                    # TypeScript 源码(编译输入,rootDir)
├── dist/                   # tsc 构建产物(.js + .d.ts + .js.map,镜像 src 结构)
├── scripts/                # 构建 / 安装 / 类型生成脚本
├── spikes/                 # 探索性原型(如 06-mcp-server)
├── tests/                  # 单元测试(vitest,tsconfig 已 exclude)
├── build/                  # ncc bundle 产物(build/bundle/sillyhub-daemon.js,git 忽略)
├── package.json            # npm 元信息 + 依赖 + scripts
├── tsconfig.json           # NodeNext / ES2022 / strict,outDir=./dist
├── vitest.config.ts        # 主测试配置
├── vitest.spikes.config.ts # spikes 独立测试配置
├── pnpm-lock.yaml / .npmrc # pnpm@9.6.0 锁文件与覆盖配置
└── README.md / .dockerignore / .gitattributes / .gitignore
```

## src/ 模块职责

- **入口 / 进程编排**
  - `cli.ts` — commander CLI 入口(对应 `bin: dist/cli.js`),装配 HubClient / Daemon / TaskRunner / ResilienceService / ClaudeSdkDriver 等。
  - `index.ts` — 模块导出聚合。
  - `daemon.ts` — 守护进程主类(三循环 + 会话恢复 + 控制消息路由)。
  - `task-runner.ts` — 非交互式 lease 任务编排核心(claim → spawn → adapter → submit → complete)。
  - `protocol.ts` — 与后端 WS 通信的消息协议(`WS_PATH` / `REST_PREFIX` / `MSG` 常量 / payload 类型)。

- **与 backend 通信**
  - `hub-client.ts` — HTTP 瘦客户端(原生 `fetch`,lease 生命周期 + 注册/心跳/恢复/spec 同步 + `getExecutionContext` / `getSpecBundle` / `postSpecSync` / `dispatch_worker` 等)。
  - `ws-client.ts` — WebSocket 客户端(基于 `ws`,`http→ws` / `https→wss` 自动转换 + 自动重连 + 内建 RPC)。

- **AI 运行时(interactive/)** — 交互式 / 流式 agent 驱动
  - `driver.ts` — 驱动抽象(`InteractiveProvider = 'claude' | 'codex'`)。
  - `claude-sdk-driver.ts` — 基于 claude-agent-sdk 的 Claude Code 驱动(query / interrupt / canUseTool / resume)。
  - `codex-app-server-driver.ts` — Codex app-server 驱动(并列 provider)。
  - `session-manager.ts` / `session-store-persistence.ts` — 会话生命周期 / 空闲扫描 / 快照落盘与启动恢复。
  - `permission-resolver.ts` — tool 权限 ↔ backend REQUEST/RESPONSE 桥接。
  - `input-queue.ts` — 跨 turn 的 AsyncIterable 输入队列。
  - `types.ts` — 复用 SDK 的 `Query` / `SDKMessage` / `SDKResultMessage` 类型。

- **adapters/** — AI 输出流协议适配器(6 协议)
  - `stream-json.ts` / `json-rpc.ts` / `jsonl.ts` / `ndjson.ts` / `pi-json.ts` / `text.ts` — 多种流式格式解析。
  - `protocol-adapter.ts` — 统一 `ProtocolAdapter` 接口。
  - `index.ts` — `PROTOCOL_PROVIDERS` 反查表 + 启动期断言。

- **MCP**
  - `mcp-server.ts` — stdio MCP 服务(`@modelcontextprotocol/sdk` 的 `McpServer` + `StdioServerTransport`),向 team 主 agent 暴露 daemon 工具。
  - `mcp-config.ts` — MCP 服务端配置装配。

- **policy/** — 文件 / 命令策略与审计
  - `filesystem-policy.ts` / `runtime-policy.ts` — 写入与执行策略。
  - `audit-sink.ts` — 审计日志下沉。
  - `path-utils.ts` / `shell-paths.ts` — 路径规整与 shell 解析。

- **resilience/** — 网络韧性
  - `error-classify.ts` — 错误分类(可重试 / 致命)。
  - `outbox.ts` — 文件 outbox(断网消息暂存,同步落盘防 Win EBUSY)。
  - `service.ts` — 韧性服务门面(由 cli.ts 注入)。

- **宿主文件系统 / RPC**
  - `host-fs-handler.ts` — 宿主文件系统操作处理器。
  - `file-rpc.ts` — 受限文件读写 RPC(`assertWithinAllowedRoots` 防 `allowed_roots` 越界)。
  - `roots-rpc.ts` — roots 相关 RPC。

- **凭证 / 环境**
  - `credential.ts` — `{{USER_XXX}}` 凭证占位符替换。
  - `credential-injector.ts` — 凭证注入到 spawn 子进程(含 `CLAUDE_CONFIG_DIR` 隔离等)。
  - `spawn-env.ts` — `buildSpawnEnv` / `redactEnv` 子进程环境构造(三层合并)。
  - `preflight.ts` — 启动前检查。

- **通用工具 / 元信息**
  - `workspace.ts`(WorkspaceManager,git 操作,`GitError`)、`config.ts`(`loadConfig` / `~/.sillyhub/daemon/config.json`)、`types.ts`、`api-types.ts`(由后端 OpenAPI 生成)。
  - 版本与构建:`version.ts`(外部 agent CLI SemVer + 最低版本校验)、`daemon-version.ts`(daemon 自身版本)、`cursor-version.ts`、`build-id.ts`(构建 ID)。
  - 其它:`agent-detector.ts`(本机 agent CLI 探测)、`tool-kind.ts`(工具分类徽标)、`permission-rules.ts`(权限规则)、`spec-sync.ts`(spec bundle 同步工具)、`skill-manager.ts`(skill 管理)、`runtime-lock.ts`(运行时锁,防多实例)、`terminal-launcher.ts` / `terminal-observer.ts`(终端拉起 / 观察)、`cmd-shim.ts`(Windows 命令 shim)。

## scripts/

- `build-bundle.sh` — `tsc` → `@vercel/ncc` 把 `dist/cli.js` 及依赖(含 claude-agent-sdk 原生包)打成单文件 `build/bundle/sillyhub-daemon.js`(用于 self-update / 远程升级分发)。
- `install.sh` / `install.ps1` — 跨平台安装脚本(Linux/macOS 与 Windows)。
- `gen-api-types.mjs` — 调用 `openapi-typescript` 从后端 OpenAPI 生成 `src/api-types.ts`。

## dist/ 与 build/

- **dist/** — `tsc` 构建产物,目录结构与 src 一一对应(`interactive/`、`adapters/`、`policy/`、`resilience/` 子目录均镜像)。包含 `.js`(运行入口,`main` / `bin` 指向 `dist/cli.js`)、`.d.ts`(类型声明,tsconfig 开启 `declaration`)、`.js.map`(source map)。
- **build/** — ncc bundle 产物(`build/bundle/sillyhub-daemon.js`,单文件零依赖,仅依赖 node runtime),git 忽略。

## spikes/

探索性原型目录,独立 vitest 配置(`vitest.spikes.config.ts`)。当前有 `06-mcp-server/`(`server.ts` + `spike.test.ts` + `README.md`),用于验证 MCP server 接入团队主 agent 的能力。
