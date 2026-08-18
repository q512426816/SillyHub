---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 集成（Integrations）

按集成对象分组，每项给依据文件。全部基于 `sillyhub-daemon/src` 实际源码与 `package.json` 依赖清单核实（744e3de4）。

## 1. 平台后端（SillyHub backend）

### 1.1 WebSocket 实时控制通道
- `ws` `^8.18.0`（package.json dependencies）。
- 封装 `src/ws-client.ts`；端点 `WS_PATH = '/api/daemon/ws'`（`src/protocol.ts:332`），URL 拼 `?daemon_local_id=<runtimeId>` 查询参数（ws-client.ts:373）。
- 鉴权：配置 apiKey 时经 ws 库 headers 选项带 `X-API-Key`（backend 校验，缺头 4001）；未配置不带头保持向后兼容（ws-client.ts:378-387）。
- 消息协议 `MSG` 常量集中于 `src/protocol.ts`（task_available / heartbeat / register / lease_claim / lease_start / lease_complete / lease_messages / rpc / rpc_result / SESSION_* / PERMISSION_*），值与 backend `protocol.py` 逐字对齐。

### 1.2 HTTP API（lease 生命周期 + 注册/恢复，`/api/daemon` 前缀）
- Node 20 原生 `fetch`（零 HTTP 库），封装 `src/hub-client.ts`（`REST_PREFIX='/api/daemon'`）。
- 鉴权优先级：apiKey → `X-API-Key`（daemon 长期凭证）；token → `Authorization: Bearer`（短期 JWT）；都缺不带（hub-client.ts:310-324）。
- 端点：register / heartbeat / markOffline / claimLease / startLease / leaseHeartbeat / submitMessages / completeLease / getPendingLeases / syncStatus / notifyRunResult / notifySessionEnd / notifySessionReady / recoverSession / confirmReconnected / markRecoveryFailed。
- 约定：body snake_case 对齐 backend Pydantic；超时 `AbortSignal.timeout(30_000)`；非 2xx 抛 `HubHttpError`。

### 1.3 HTTP API（agent router 端点，`/api` 前缀，非 `/api/daemon`）
- `src/hub-client.ts:1126-1269`：5 个 missions 端点走 `/api` 前缀——`POST /api/workspaces/{ws}/missions/{mid}/dispatch_worker`（dispatchWorker）、`GET .../workers/{wid}/result`（getWorkerResult）、`GET .../workers`（listWorkers）、`POST .../converge`（convergeMission）、`POST .../progress`（reportProgress，进度回传）。
- 另有 `GET /api/agent-runs/{id}/execution-context`（getExecutionContext）与 spec 端点（见 1.4/1.5），同为 `/api` 前缀。

### 1.4 spec 全量同步（tar bundle 双向）
- `src/hub-client.ts`：`getSpecBundle` → `GET /api/workspaces/{wsId}/spec-workspace/bundle`（拉 tar）；`postSpecSync` → `POST .../spec-workspace/sync`（推 tar）。
- `src/spec-sync.ts`：pullSpecBundle（含 404 容错 + Tar Slip 防护解包）/ packSpecDir（手动 tar 头打包）/ hasUnsyncedLocalChanges（pull 前回灌检查）。

### 1.5 spec 增量同步（manifest + 增量 ops）
- `src/hub-client.ts:985`：`postSpecSyncIncremental` → `POST /api/workspaces/{wsId}/spec-workspace/sync-incremental`（spec-file-incremental-sync 变更新的端点；URL 必须 `/api` 前缀，用 REST_PREFIX 恒 404）。
- `src/spec-sync.ts`：`syncSpecTreeIfNeeded` 编排、`resolveManifestCachePath` 本地 manifest 缓存（hash/版本对账）、`extractChangeDirs`（ops → change 目录）、`shouldRefreshSpec` / `bumpLocalSpecVersion`（spec_version 保鲜）。

### 1.6 变更写回 + 同步进度（change-writes）
- `src/hub-client.ts`：`getPendingChangeWrites` / `claimChangeWrite` / `completeChangeWrite` / `reportChangeWriteProgress` → `PATCH /api/daemon/change-writes/{id}/progress`（spec-sync-visibility；claimed 单一写者，终态由 completeChangeWrite 置 done/failed）。

### 1.7 OpenAPI 类型契约生成
- `openapi-typescript` `^7.13.0`（devDependency）；`scripts/gen-api-types.mjs` 从 backend OpenAPI 生成 `src/api-types.ts`（`pnpm gen:types` / `gen:types:check` 校验未漂移）。

### 1.8 skills 分发
- `src/skill-manager.ts`：`GET /api/daemon/skills/latest/manifest`（版本 + 文件清单 + sha256），下载 bundle 校验后落盘 `~/.sillyhub/daemon/skills/`，本地 manifest 记版本。

### 1.9 MCP 白名单拉取
- `src/mcp-config.ts:1295-1326`：`GET /api/platform-settings/mcp-whitelist`（admin 全局白名单）。

### 1.10 关于 shpsync_ 工作区 token
- `shpsync_` 前缀 token 是 backend `connect` 端点签发给 CLI（sillyspec）侧的工作区凭证（见 `src/api-types.ts` schema 注释）；daemon 自身不持有 shpsync_，daemon 侧所有平台调用走 X-API-Key / Bearer（1.2）。daemon 相关的"进度回传"是 1.3 reportProgress 与 1.6 change-writes progress。

## 2. LLM / Agent 运行时

### 2.1 Claude Agent SDK（交互式会话核心）
- `@anthropic-ai/claude-agent-sdk` `0.3.181`（精确版本）；`pnpm.overrides` 把 8 个平台 optional 包统一解析到主包（ncc 打包内联）。
- 封装 `src/interactive/claude-sdk-driver.ts`：`import { query }`，prompt AsyncIterable + options（canUseTool / model / allowedTools / resume / pathToClaudeCodeExecutable / mcpServers）；`interrupt` turn 级中断；GLM passthrough 有专项测试（tests/interactive/claude-sdk-driver-glm-passthrough.test.ts）。
- `src/interactive/types.ts` 以 `import type` 复用 SDK 的 `Query` / `SDKMessage` / `SDKResultMessage`。

### 2.2 llm-proxy 透传（hub 代理形态）
- `src/credential-injector.ts:122-133`：provider_config `litellm_proxy` 形态下，`ANTHROPIC_BASE_URL` 指向 `<hub>/api/daemon/llm-proxy`、`ANTHROPIC_AUTH_TOKEN` 注 daemon apiKey（master key 不下发到 daemon，子进程 Bearer 打 hub 代理）；openai 形态经 LiteLLM 网关（`litellm_base_url`）。
- 配套：`src/types.ts`（ProviderConfig.litellm_base_url / litellm_proxy）、`src/cli.ts:521-522`、`src/spawn-env.ts:152`（进程级 _daemonApiKey 覆盖点）。

### 2.3 Codex（并列 provider）
- `src/interactive/codex-app-server-driver.ts`（CodexAppServerDriver），`InteractiveProvider = 'claude' | 'codex'`；approval 桥接有专项测试。

### 2.4 本地 coding agent CLI（非交互 lease）
- `src/task-runner.ts`：`node:child_process` spawn + `node:readline` 流式采集，默认 provider claude。
- `src/agent-detector.ts`（env 覆盖 → PATH which → 不可用）+ `src/version.ts`（SemVer 最低版本校验）+ `src/cmd-shim.ts`（Windows .cmd 包装解析）。

## 3. MCP（Model Context Protocol）

- `@modelcontextprotocol/sdk` `^1.29.0`；`src/mcp-server.ts` 用 `McpServer` + `StdioServerTransport` 起 stdio server（import.meta.url 主模块判定后 `runMcpServer()`）。
- 工具清单（mcp-server.ts registerTool，共 5 个）：`dispatch_worker` / `get_worker_result` / `list_workers` / `converge_mission` / `report_progress`——HubClient 作后端通道（测试可传 mock）。
- 注入：仅 team 主 agent（`ctx.stage === 'orchestrator'`）经 `src/cli.ts:707-739` mainAgentMcpConfigProvider 构造 `command=node + args=[dist/mcp-server.js]`，透传 SDK `options.mcpServers`。
- 鉴权：`MCP_SERVER_DAEMON_API_KEY`（X-API-Key 优先路径）与 `MCP_SERVER_DAEMON_TOKEN`（Bearer）分开透传（api_key 优先回落 token，cli.ts:714-721）；McpToken 的签发/吊销在平台侧（api-types.ts schema），daemon 内置 server 不消费 McpToken。
- 配置合并：`src/mcp-config.ts`（平台默认 + workspace `.mcp.json`，白名单过滤，仅允许 stdio 类型防 SSRF）；spike 原型 `spikes/06-mcp-server/`。

## 4. 本地环境

### 4.1 配置与工作区目录
- `~/.sillyhub/daemon/`（`src/config.ts` DEFAULT_CONFIG_DIR）：config.json / daemon.pid / daemon.log / sessions.json / specs/{wsId}（spec 解包目录，spec-sync.ts resolveSpecDir）/ skills/ / workspaces/ / runs/{leaseId}/terminal.log。
- `src/workspace.ts`（WorkspaceManager）：git 做 spec 拉取/推送与状态，失败抛 `GitError`。

### 4.2 .sillyspec/local.yaml 读写
- `src/local-yaml-writer.ts`：文本级顶层段替换（`platform:` / `mcp:` 段），CRLF 原样还原（Windows 兼容）；由 spec-sync.ts 在同步流程中回写工作区 `.sillyspec/local.yaml`。

### 4.3 Claude settings 写入
- `src/claude-settings.ts`：spawn 前写 `$CLAUDE_CONFIG_DIR/settings.json`，白名单键 attribution / enabledPlugins / model / skipDangerousModePermissionPrompt；不写 env（归 credential-injector）、不写 api_key。

### 4.4 终端拉起
- `src/terminal-launcher.ts`：按平台弹独立终端 tail 日志（Windows wt.exe / macOS Terminal.app / Linux x-terminal-emulator），`--terminal-command` 自定义模板（{log} {title}），失败静默不影响任务；`src/terminal-observer.ts` 观察日志流。

### 4.5 Windows 兼容
- `src/cmd-shim.ts`：静态解析 npm cmd-shim 生成的 .cmd 包装提取真实 exe，spawn 不依赖 shell（规避 git-bash/PowerShell 差异）；`src/cursor-version.ts` 配套版本条目解析。

## 5. 工具链

- **tsc**：`package.json` `build` / `typecheck`（typescript 5.5.4）。
- **vitest** `^2.0.0`：tests/ 141 个 .test.ts，forks 池限 8 + 30s 超时（`vitest.config.ts`）；spikes 走 `vitest.spikes.config.ts`。
- **ncc bundle**：`@vercel/ncc` `^0.44.0`，`scripts/build-bundle.sh` 产 `build/bundle/sillyhub-daemon.js` 单文件（self-update 分发）。
- **gen-build-id**：`scripts/gen-build-id.mjs`，`prebuild` / `postinstall` 钩子生成构建 ID（`src/build-id.ts`）。
- **安装脚本**：`scripts/install.sh`（Linux/macOS）+ `scripts/install.ps1`（Windows）。
- **包管理 / 运行时**：pnpm 9.6.0（packageManager）、Node `>=20.0.0`（engines）。
- **其它运行时依赖**：`commander` ^12.1.0（CLI）、`zod` ^4.4.3（schema 校验）、`js-yaml` ^4.1.0（YAML 解析）。
