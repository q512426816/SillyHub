---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 测试(Testing)

## 框架与配置

- 测试框架:**vitest 2**(devDependency `vitest ^2.0.0`),`environment: 'node'`,`globals: false`(用例内显式 import `describe`/`it`/`expect`)。
- 两套 vitest 配置:
  - `vitest.config.ts`——主套件,`include: ['tests/**/*.test.ts']`,即 `pnpm test`(`vitest run --passWithNoTests`)。
  - `vitest.spikes.config.ts`——探索性 spike 专用,`include: ['spikes/**/*.test.ts']`,**不进 CI 主套件**,需手动 `pnpm vitest run --config vitest.spikes.config.ts`。
- 并发与超时:`pool: 'forks'`,`maxForks: 8`(本机 20 核限到 40%),`testTimeout: 30000`。配置注释说明:套件含大量真实文件 I/O(tar 解包/打包、mkdtemp、spec sync),在 20 路并行 fork 池 + Windows AV 扫描下 vitest 默认 5s 超时偶发 flaky,30s 是给足余量的上限(<5s 用例照常秒过)。

## 测试规模与分布

- 主套件 **117 个测试文件**(`sillyhub-daemon/tests/**/*.test.ts`);spike 套件 1 个(`spikes/06-mcp-server/spike.test.ts`)。
- 按目录分布(主要模块):
  - `tests/interactive/`——交互式会话:session-manager / claude-sdk-driver / codex-app-server-driver / session-recovery / session-store-persistence / idle-scanner / permission-resolver / input-queue / driver 等(约 24 文件,**最重区域**)。
  - `tests/adapters/`——6 协议适配器:stream-json / jsonl / ndjson / text / json-rpc / pi-json / protocol-adapter / factory。
  - `tests/resilience/`——网络韧性:dedup-key / error-classify / outbox / resilience-service。
  - `tests/policy/`——文件系统策略与权限:filesystem-policy / runtime-policy / path-utils / shell-paths / audit-sink / allowed-roots-temp-paths。
  - `tests/spec-transport-tar-sync/` 及顶层 `task-09-*` / `task-13-spec-sync` / `spec-sync`——spec 同步(task-09 `.runtime` tar pull/push)。
  - 顶层散布:cli / daemon / task-runner / hub-client / ws-client / credential / workspace / skill-manager / agent-detector / version / config / runtime-lock / preflight / tool-kind / terminal-launcher / terminal-observer / cmd-shim 等。
- 覆盖手段:真实子进程 spawn(claude/codex fake child)、mock backend HTTP、tar 解包、mkdtemp 临时工作区、permission-rules 决策表;集成测试以 `.integ.test.ts` 命名(如 `agent-detector.system-claude.integ.test.ts`)。

## 基线与已知 flaky 区

- 基线(据 `docs/code-quality-hardening-2026-07-24.md` §3/§6):全量 **1950 passed / 2 failed**;2 个失败均为 `task-09 spec-sync` 的 vitest hook 10s 超时(**环境性 flaky**),重跑 `daemon-interactive-spec-sync.test.ts` 14 passed 确证非代码逻辑引入。
- 已知脆弱区:`task-09 spec-sync`(spec bundle pull/push,真实 tar I/O 大)、`lease.kind` 分流(D-002 策略变更在途)——对应 memory `sillyspec-324-verify-archive-pitfalls`、`daemon-client-spec-sync-broken`。
- 改完跑对应子目录(如 `pnpm vitest run tests/interactive/`);`pnpm typecheck`=`tsc --noEmit` 全绿是合入前置(`tsconfig` 开 `strict` + `noUncheckedIndexedAccess` + `verbatimModuleSyntax` + `NodeNext`,源码无 `: any`/`as any` 逃逸)。

## 开发命令

| 命令 | 作用 |
| --- | --- |
| `pnpm test` | vitest 全套 run(`--passWithNoTests`) |
| `pnpm test:watch` | vitest watch 模式 |
| `pnpm typecheck` | 仅类型检查(`tsc --noEmit`) |
| `pnpm vitest run tests/<dir>/` | 跑单个子目录(改某模块后定向验证) |
| `pnpm vitest run --config vitest.spikes.config.ts` | 跑 spike 套件(默认不跑) |
