---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 测试（Testing）

## 框架与配置

- 测试框架：**vitest 2**（devDependency `vitest ^2.0.0`），`environment: 'node'`，`globals: false`（用例内显式 import `describe`/`it`/`expect`）。
- 两套 vitest 配置：
  - `vitest.config.ts`——主套件，`include: ['tests/**/*.test.ts']`，即 `pnpm test`（`vitest run --passWithNoTests`）。
  - `vitest.spikes.config.ts`——探索性 spike 专用，`include: ['spikes/**/*.test.ts']`，**不进 CI 主套件**，需手动 `pnpm vitest run --config vitest.spikes.config.ts`；并发更低（`maxForks: 2`，注释说明 stdio 子进程 spawn + mock backend HTTP 单文件串行更稳）。
- 并发与超时（vitest.config.ts 注释原文依据）：套件含大量真实文件 I/O（tar 解包/打包、mkdtemp、spec sync），在满核 fork 池 + Windows AV 扫描下 vitest 默认 5s 超时偶发 flaky，故 `testTimeout: 30000`；`pool: 'forks'`，`maxForks: 8`（本机 20 核限到 40%，降低磁盘争用；CI ≤8 核环境天然不受影响）。

## 测试规模与分布

- 主套件 **141 个测试文件**（Glob `sillyhub-daemon/tests/**/*.test.ts` 统计）；spike 套件 1 个（`spikes/06-mcp-server/spike.test.ts`）。
- 按目录分布（Glob 实数）：

| 目录 | 文件数 | 覆盖 |
| --- | --- | --- |
| `tests/`（顶层） | 81 | daemon / task-runner / hub-client / ws-client / spec-sync（含 incremental / task-09 pull-push / task-13） / cli / config / credential(-injector) / workspace / skill-manager / agent-detector / mcp-server / mcp-config / host-fs-handler / permission-rules / terminal-* / preflight 等 |
| `tests/interactive/` | 36 | 交互式会话：session-manager（十几个切面：permission/usage-cache/budget/pending-switch/config-switch 等）/ claude-sdk-driver / codex-app-server-driver / driver / session-recovery / session-store-persistence / input-queue / permission-resolver，**最重区域** |
| `tests/adapters/` | 7 | 6 协议适配器（jsonl / ndjson / pi-json / json-rpc / text / protocol-adapter）+ factory |
| `tests/policy/` | 7 | filesystem-policy / runtime-policy / path-utils / shell-paths / audit-sink / daemon-policy-update / allowed-roots-temp-paths |
| `tests/resilience/` | 4 | dedup-key / error-classify / outbox / resilience-service |
| `tests/spec-transport-tar-sync/` | 3 | spec tar 同步（task-runner-stage / daemon-interactive / spec-sync） |
| `tests/spec-strategy/`、`tests/model-error/`、`tests/daemon/` | 各 1 | pull-strategy / classifier / sync-allowed-roots |
| `tests/e2e/` | 0 | 仅 VERIFY-REPORT.md 文档，无测试文件 |

- 组织惯例：测试不与源码 co-locate，集中在独立 `tests/` 树，子目录名镜像 `src/` 模块结构（adapters/ interactive/ policy/ resilience/ model-error/）；集成测试以 `.integ.test.ts` 后缀命名（如 `agent-detector.system-claude.integ.test.ts`）。

## 测试模式（真实文件举例）

- **`tests/ws-client.test.ts`（ws 用真实回环服务，不 mock 库）**：用 ws 包起真实本地服务 `new WebSocketServer({ port: 0 })`（L34）验证握手/心跳/重连行为；注释明确不用 fake timers——`connect()` 内部 `new WebSocket` 的 TCP 握手是 libuv 异步 IO（L386）。
- **`tests/interactive/claude-sdk-driver.test.ts`（SDK 一律 mock）**：文件头注释「SDK 一律 mock（vitest vi.mock），不连真实 bigmodel（CI 不依赖网络/鉴权）」；用 `vi.hoisted` + `vi.mock('@anthropic-ai/claude-agent-sdk')`（L75）连同 `vi.mock('node:fs')`（L31，ESM 导出不可运行时替换故整模块 mock）在 import 前 hoist。
- 其它常用手段：真实子进程 spawn（claude/codex fake child）、mock backend HTTP、tar 解包、mkdtemp 临时工作区、permission-rules 决策表。

## 类型契约守护（gen:types:check）

- `pnpm gen:types`：`scripts/gen-api-types.mjs` 复用 `../backend/openapi.json` 作为单一契约源（不重新 dump，避免 daemon 端依赖 Python/uv），经 openapi-typescript 生成 `src/api-types.ts`，消除 daemon 端手写 TS 类型漂移。
- `pnpm gen:types:check`：重新生成 + `git diff --exit-code src/api-types.ts` 守门——backend 契约变更而 daemon 类型未再生时 CI 红。
- 脚本内置 node_modules 健康自检：openapi-typescript `.bin` shim 缺失时给出明确报错与修法（`pnpm install --force`），防 pnpm 半坏误判成包损坏。

## 构建验证

- `pnpm typecheck` = `tsc --noEmit` 全绿是合入前置（strict + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + NodeNext）。
- `pnpm build` = `tsc` 产出 `dist/`（prebuild 自动跑 `scripts/gen-build-id.mjs` 生成 build-id）；`pnpm bundle` = `bash scripts/build-bundle.sh` 用 @vercel/ncc 打单文件 `dist/cli.js`（self-update 分发用）。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `pnpm test` | vitest 全套 run（`--passWithNoTests`） |
| `pnpm test:watch` | vitest watch 模式 |
| `pnpm typecheck` | 仅类型检查（`tsc --noEmit`） |
| `pnpm vitest run tests/<dir>/` | 跑单个子目录（改某模块后定向验证） |
| `pnpm vitest run --config vitest.spikes.config.ts` | 跑 spike 套件（默认不跑） |
| `pnpm gen:types:check` | api-types.ts 漂移守门 |
