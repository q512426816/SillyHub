# 架构(Architecture)

---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

## 技术栈

sillyhub-daemon 是 SillyHub 平台的本地守护进程(Node.js 重写版,原 Python 实现已废弃),运行在开发者/业务人员本机,负责在本地隔离环境中驱动 Claude Code agent 执行任务,并通过 WebSocket 长连接与后端 backend 协同。

- **运行时与语言**:Node.js ≥ 20(`engines.node`),ESM(`package.json` 中 `"type": "module"`);TypeScript 5.5.4(`tsconfig.json` target `ES2022`、module/moduleResolution `NodeNext`、`strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `isolatedModules`,`rootDir=src`、`outDir=dist`)。包管理器 pnpm 9.6.0(`packageManager`)。
- **核心依赖**(`package.json` dependencies):
  - `@anthropic-ai/claude-agent-sdk` `0.3.181` —— 驱动 Claude Code agent 执行;通过其 `query({ prompt: AsyncIterable, options })` 入口发起同进程多轮(interactive 链路)。
  - `@modelcontextprotocol/sdk` `^1.29.0` —— MCP 工具注入,daemon 内置 MCP server 走 stdio transport(`McpServer` + `StdioServerTransport`),供主 agent 调用平台工具。
  - `commander` `^12.1.0` —— CLI 子命令(`start`/`stop`/`status`/`logs`)。
  - `ws` `^8.18.0` —— 与 backend 的 WebSocket 长连接,接收任务、回写结果。
  - `zod` `^4.4.3` —— 运行时校验。
  - `js-yaml` `^4.1.0` —— YAML 解析。
- **HTTP**:Node 20 原生 `fetch`(零 HTTP 库依赖,`hub-client.ts` 采用)。
- **构建与发布**:`tsc` 编译(`dev`/`build`/`typecheck`/`start` 脚本);`@vercel/ncc` `^0.44.0` 经 `scripts/build-bundle.sh` 打成单文件 bundle(产物 `build/bundle/sillyhub-daemon.js` + 独立子进程入口 `mcp-server.js`),`BUILD_ID`(git SHA)注入 `src/build-id.ts`,配合 daemon self-update 对齐 backend `get_latest_manifest`;`openapi-typescript` 生成 `src/api-types.ts`(`gen:types` 脚本)。
- **pnpm overrides**:`claude-agent-sdk` 各平台可选依赖(win32/linux/darwin × x64/arm64 × musl/glibc)统一重定向到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`,绕开平台 native 依赖分发,保证跨平台一致。
- **测试**:`vitest` ^2.0.0(`environment=node`,`test` 脚本 `--passWithNoTests`)。

## 架构概览

daemon 是一个「后端事件驱动 + 本地 agent 执行」的单进程常驻边车。入口 `src/cli.ts` 用 commander 注册 `start`/`stop`/`status`/`logs` 子命令,`start` 构造并启动 `Daemon` 主循环;对上承接 backend(WebSocket + HTTP),对下驱动 Claude/Codex agent,并向 backend 上报 lease 生命周期与交互式会话状态。

核心组件(均为 `sillyhub-daemon/src` 下 `.ts` 模块):

- **`Daemon`(`daemon.ts`)**:守护总编排,维护三循环(HTTP 轮询 / WS 心跳 / lease 执行),持有下列组件实例,启动时对持久化 session 调 `recoverSession` + `restoreAndReconnect`(query resume),路由 `SESSION_INJECT/INTERRUPT/END` 与 `PERMISSION_RESPONSE` 控制消息。
- **`WsClient`(`ws-client.ts`)**:`ws` WebSocket 客户端(`new WebSocket(url)`),`http(s)://` → `ws(s)://` 转换,收发 `DaemonMessage`;接收 `task_available` 分派给 `TaskRunner`;RPC 请求走独立分支不污染 lease 消息分发;自动重连。不含 lease 状态机(归 Daemon)。
- **`HubClient`(`hub-client.ts`)**:backend REST 瘦客户端,每次请求独立原生 `fetch`(无连接池,超时 `AbortSignal.timeout(30_000)`)。封装 lease 生命周期(`claim`/`start`/`heartbeat`/`submit_lease_messages`/`complete_lease`/`sync_status`)、`close_interactive_run`(`notifyRunResult`,绑定 lease 的 `X-Claim-Token`)、self-update manifest、skills manifest 等。
- **任务执行分两条链路**:
  1. **batch / task 链路 —— `TaskRunner`(`task-runner.ts`)**:对每个非交互 lease 经 `runLease` claim→start→heartbeat→submitMessages→complete,spawn agent 子进程,`getBackend(provider)`(默认 `claude`)取 adapter 解析输出;spawn 前由 `credential.ts`/`spawn-env.ts` 注入凭证与隔离环境(`CLAUDE_CONFIG_DIR` 指向 `~/.sillyhub/.../claude-config`,避免读宿主机 `~/.claude/settings.json` 造成 cc-switch 环境污染)。
  2. **interactive 链路 —— `SessionManager`(`interactive/session-manager.ts`)**:同进程多轮,直接调 SDK `query({ prompt: AsyncIterable, options })`(由 `claude-sdk-driver.ts` 封装,`codex-app-server-driver.ts` 为另一 provider 驱动);`input-queue.ts` 提供跨 turn 长生命周期 AsyncIterable,`permission-resolver.ts` 把 tool 权限请求映射为 backend `PERMISSION_REQUEST/RESPONSE` 往返,`session-store-persistence.ts` 落盘 session 快照(`~/.sillyhub/daemon/sessions.json`)支持重启恢复。
- **MCP 工具注入**:`mcp-server.ts` 提供 daemon 内置 MCP server,注册平台工具(如 `dispatch_worker` 等,team 主 agent 链路);`mcp-config.ts` 负责加载/校验/合并 platform_default + daemon 内置 server(`loadPlatformMcpConfigFromBackend` + `validateMcpServers` 白名单 + `mergeMcpConfigs`),`buildDaemonMcpServerConfig` 构造 spawn 配置,在主 agent spawn 时经 `mainAgentMcpConfigProvider` 注入(clique 隔离:`isMainAgentSession` 谓词配对)。
- **协议适配**:`adapters/`(stream-json、json-rpc、jsonl、ndjson、text、pi-json、protocol-adapter、index)适配不同 agent 输出协议,统一归一到内部 `protocol.ts` 消息模型(`PROTOCOL_PROVIDERS` 正向映射 + `PROVIDER_TO_PROTOCOL` 反查)。
- **韧性与恢复**:`resilience/`(outbox + error-classify + service)做应用层去重与离线 outbox 落盘防丢;`runtime-lock.ts` 防止多 daemon 实例并发;interactive session 持久化 + `recoverSession`/`restoreAndReconnect` 支持断点恢复(注:恢复≠断点续跑,见 daemon 恢复能力边界)。
- **策略与文件访问**:`policy/`(filesystem-policy、runtime-policy、audit-sink、path-utils、shell-paths)实施文件系统访问策略与审计;`host-fs-handler.ts`、`file-rpc.ts`(`assertWithinAllowedRoots` 防 `allowed_roots` 越界)、`roots-rpc.ts` 处理宿主文件系统 RPC。
- **辅助模块**:`config.ts`(配置加载,含 `CLAUDE_CONFIG_DIR` 常量)、`preflight.ts`(启动前检查 + BUILD_ID)、`daemon-version.ts`/`agent-detector.ts`(版本与 agent 探测,`PROVIDER_SPECS`)、`version.ts`/`cursor-version.ts`(外部 CLI semver 校验)、`skill-manager.ts`(workspace skills 同步,对齐 backend `get_skills_manifest`)、`spec-sync.ts`(SillySpec spec bundle 双向同步,含 Tar Slip 防护,纯函数式供 interactive 路径复用)、`terminal-launcher.ts`/`terminal-observer.ts`(可选本地终端 tail)。

数据流概要:backend 投递 lease → WsClient 接收 → Daemon 分派(TaskRunner spawn 或 SessionManager SDK query)→ agent 执行中经 adapters 解析输出 → HubClient 经 lease API 回写消息/usage/结果 → 完成 `complete_lease`,或 interactive 走 `notifyRunResult` + `close_interactive_run`(用 `X-Claim-Token` 校验 + 绑定 session 防跨会话注入)。
