---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 目录结构（Structure）

sillyhub-daemon 是 SillyHub 平台的本地守护进程（Node.js / TypeScript），负责在本机执行 AI 任务、驱动 Claude Code / Codex 交互式会话，并通过 HTTP + WebSocket 与平台后端通信。ESM 工程，`rootDir=src`、`outDir=dist`，NodeNext + strict，Node >= 20，pnpm 9.6.0。

## 顶层布局

```
sillyhub-daemon/
├── src/                    # TypeScript 源码（rootDir），62 个 .ts 文件
├── dist/                   # tsc 构建产物（.js + .d.ts + .js.map，镜像 src 结构）
├── build/                  # ncc bundle 产物（build/bundle/：sillyhub-daemon.js + mcp-server.js + index.js，git 忽略）
├── scripts/                # 构建 / 类型生成 / 安装脚本（5 个）
├── spikes/                 # 探索性原型（06-mcp-server/，独立 vitest 配置）
├── tests/                  # 单元测试（vitest，141 个 .test.ts）
├── package.json            # npm 元信息 + 依赖 + scripts
├── tsconfig.json           # NodeNext / ES2022 / strict，outDir=./dist
├── vitest.config.ts        # 主测试配置（include tests/**/*.test.ts，forks 池限 8）
├── vitest.spikes.config.ts # spikes 独立测试配置
├── pnpm-lock.yaml / .npmrc # pnpm 锁文件与 overrides 配置（claude-agent-sdk 8 平台包统一）
├── README.md / .dockerignore / .gitattributes / .gitignore
└── .mypy_cache/ / .ruff_cache/ 等历史缓存与 isolate-*.log 运行残留（非工程结构）
```

## src/ 一级清单（35 个文件）

- **入口 / 进程编排**
  - `cli.ts` — commander CLI 入口（`start` / `stop` / `status` / `logs` 四命令），装配 HubClient / Daemon / TaskRunner / ResilienceService / SessionManager，并构造 team 主 agent 的内置 MCP 注入配置（isMainAgentSession / mainAgentMcpConfigProvider）。
  - `index.ts` — 模块导出聚合。
  - `daemon.ts` — 守护进程主类（轮询 + 心跳 + WS 三循环、会话恢复、控制消息路由）。
  - `task-runner.ts` — 非交互式 lease 任务编排核心（claim → spawn → adapter → submit → complete）。
  - `protocol.ts` — 与后端 WS 通信的消息协议常量（`MSG` 消息类型 / `WS_PATH='/api/daemon/ws'` / `REST_PREFIX='/api/daemon'` / lease 状态），值与 backend 逐字对齐。
- **与 backend 通信**
  - `hub-client.ts` — HTTP 瘦客户端（原生 `fetch`，29 个公开方法：lease 生命周期、注册/心跳/恢复、spec 全量+增量同步、change-writes 认领/完成/进度、missions worker 派发/结果/汇聚/进度）。
  - `ws-client.ts` — WebSocket 客户端（`ws` 库，http→ws / https→wss 自动转换 + 自动重连 + 内建 RPC 分发，鉴权经 `X-API-Key` 头）。
- **MCP**
  - `mcp-server.ts` — 内置 stdio MCP server（`McpServer` + `StdioServerTransport`，注册 dispatch_worker / get_worker_result / list_workers / converge_mission / report_progress 5 个工具；以 `node dist/mcp-server.js` 子进程形态运行）。
  - `mcp-config.ts` — MCP 配置合并 + 白名单过滤 + 注入（平台默认 + workspace `.mcp.json`，仅允许 stdio 类型）。
- **spec 同步**
  - `spec-sync.ts` — spec 树同步共享 utility（tar 全量 pull/push、增量 `sync-incremental`、本地 manifest 缓存、`.sillyspec/local.yaml` 回写、`sillyspec init` 拉起、init lease 处理、spec_version 保鲜）。
  - `local-yaml-writer.ts` — 文本级 YAML 顶层段替换（`platform:` / `mcp:` 段，CRLF 兼容），写工作区 `.sillyspec/local.yaml`。
  - `skill-manager.ts` — skills 同步管理（manifest 版本 + sha256 校验，落盘 `~/.sillyhub/daemon/skills/`）。
- **凭证 / 环境 / 设置**
  - `credential.ts` — `{{USER_XXX}}` 凭证占位符替换。
  - `credential-injector.ts` — 凭证注入 spawn 子进程 env（`CLAUDE_CONFIG_DIR` 隔离；`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`；litellm_proxy 形态打 hub 代理）。
  - `spawn-env.ts` — `buildSpawnEnv` / `redactEnv` 子进程环境三层合并。
  - `claude-settings.ts` — 写 `$CLAUDE_CONFIG_DIR/settings.json` 白名单顶层键（attribution / model / enabledPlugins 等，不写 env 与 api_key）。
- **宿主文件系统 / RPC**
  - `host-fs-handler.ts` — 宿主文件系统操作处理器（含 worktree 支持）。
  - `file-rpc.ts` — 受限文件读写 RPC（`assertWithinAllowedRoots` 防 `allowed_roots` 越界）。
  - `roots-rpc.ts` — roots 相关 RPC。
- **策略 / 审计**
  - `permission-rules.ts` — 权限规则匹配。
- **通用工具 / 元信息**
  - `workspace.ts` — WorkspaceManager（git spec 拉取/推送与状态，失败抛 `GitError`）。
  - `config.ts` — `loadConfig`（`~/.sillyhub/daemon/config.json`）。
  - `types.ts` — 共享类型（ProviderConfig 含 litellm_base_url / litellm_proxy 等）。
  - `api-types.ts` — 后端 OpenAPI 生成契约类型（`pnpm gen:types` 产物，禁手写）。
  - `version.ts` — 外部 agent CLI SemVer 解析 + 最低版本校验；`daemon-version.ts` — daemon 自身版本；`cursor-version.ts` — cursor 版本条目；`build-id.ts` — 构建 ID。
  - `agent-detector.ts` — 本机 agent CLI 探测（env 覆盖 → PATH which → 不可用）。
  - `tool-kind.ts` — 工具分类徽标。
  - `runtime-lock.ts` — 运行时锁（防多实例）。
  - `preflight.ts` — 启动前检查。
  - `terminal-launcher.ts` — 跨平台弹独立终端窗口 tail 日志（失败不抛错）。
  - `terminal-observer.ts` — 终端日志观察。
  - `cmd-shim.ts` — Windows npm .cmd 包装静态解析出真实 exe（spawn 不依赖 shell）。

## src/ 子目录（二级展开，27 个文件）

- **adapters/（8）** — AI 输出流协议适配器：`index.ts`（`PROTOCOL_PROVIDERS` 反查表 + 启动期断言）、`protocol-adapter.ts`（统一 `ProtocolAdapter` 接口）、`stream-json.ts`、`json-rpc.ts`、`jsonl.ts`、`ndjson.ts`、`pi-json.ts`（pi 模型 `zai/glm-5.2` 形态拆参）、`text.ts`。
- **interactive/（8）** — 交互式 / 流式 agent 驱动：`driver.ts`（驱动抽象，`InteractiveProvider = 'claude' | 'codex'`）、`claude-sdk-driver.ts`（claude-agent-sdk 驱动：query / interrupt / canUseTool / resume / mcpServers 注入）、`codex-app-server-driver.ts`（Codex app-server 驱动）、`session-manager.ts`（会话生命周期 / 空闲扫描 / 预算 / 权限）、`session-store-persistence.ts`（快照落盘与启动恢复）、`permission-resolver.ts`（tool 权限 ↔ backend REQUEST/RESPONSE 桥接）、`input-queue.ts`（跨 turn AsyncIterable 输入队列）、`types.ts`（复用 SDK 的 `Query` / `SDKMessage` 类型）。
- **model-error/（3）** — 模型错误归类：`types.ts`（`ModelError` / `ModelErrorType`）、`classifier.ts`（错误分类器，识别方括号业务码如 GLM `[1310]` 等）、`index.ts`（导出）。
- **policy/（5）** — 文件 / 命令策略与审计：`filesystem-policy.ts`（写入策略）、`runtime-policy.ts`（执行策略）、`audit-sink.ts`（审计日志下沉）、`path-utils.ts`（路径规整）、`shell-paths.ts`（shell 路径解析）。
- **resilience/（3）** — 网络韧性：`error-classify.ts`（错误分类可重试/致命 + dedup key）、`outbox.ts`（文件 outbox 断网暂存，同步落盘防 Win EBUSY）、`service.ts`（韧性服务门面，由 cli.ts 注入）。

## scripts/

- `build-bundle.sh` — `tsc` → `@vercel/ncc` 把 `dist/cli.js` 及依赖打成单文件 `build/bundle/sillyhub-daemon.js`（self-update / 远程升级分发）。
- `gen-api-types.mjs` — 调 `openapi-typescript` 从后端 OpenAPI 生成 `src/api-types.ts`（`pnpm gen:types` / `gen:types:check`）。
- `gen-build-id.mjs` — 生成构建 ID（`prebuild` / `postinstall` 钩子调用）。
- `install.sh` / `install.ps1` — 跨平台安装脚本（Linux/macOS 与 Windows）。

## 配置

- `package.json` scripts 段：`dev`（tsc --watch）、`build`、`typecheck`、`test`（vitest run --passWithNoTests）、`test:watch`、`start`、`bundle`、`gen:types`、`gen:types:check`、`prebuild` / `postinstall`（gen-build-id）。
- `bin`: `sillyhub-daemon` → `./dist/cli.js`；`main`: `./dist/cli.js`。
- `vitest.config.ts` — include `tests/**/*.test.ts`，forks 池限 8（Windows 磁盘争用），testTimeout 30s。
- `tsconfig.json` — NodeNext / ES2022 / strict，`outDir=./dist`，`rootDir=./src`，declaration + sourcemap。

## 测试文件分布（tests/，141 个 .test.ts）

- 顶层 80 个（task-runner / daemon / hub-client / ws-client / spec-sync / mcp-server / claude-settings / cmd-shim / terminal-launcher 等）。
- 子目录：`interactive/` 37、`adapters/` 7、`policy/` 7、`resilience/` 4、`spec-transport-tar-sync/` 3、`daemon/` 1、`model-error/` 1、`spec-strategy/` 1。
- 辅助目录（非测试）：`fixtures/`（5 种协议夹具 + README）、`helpers/`（fake-child.ts / server.ts）、`e2e/`（仅 VERIFY-REPORT.md，无测试）。
- spikes 另有 1 个测试（`spikes/06-mcp-server/spike.test.ts`，走 vitest.spikes.config.ts）。

## dist/ 与 build/

- **dist/** — tsc 产物，目录结构与 src 一一对应（adapters/ interactive/ model-error/ policy/ resilience/ 均镜像），含 `.js` / `.d.ts` / `.js.map`。
- **build/bundle/** — ncc 单文件产物：`sillyhub-daemon.js`（主入口）、`mcp-server.js`（MCP 子进程入口）、`index.js` + `package.json`；git 忽略。
