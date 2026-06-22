---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:48Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:48
---

# sillyhub-daemon · 测试

## 测试框架与配置

- **框架**：`vitest` ^2.0.0（devDependencies）
- **配置**：`vitest.config.ts`（`environment=node`，`include='tests/**/*.test.ts'`，`globals=false`）
- **脚本**：`pnpm test`（`vitest run --passWithNoTests`）/ `pnpm test:watch`（`vitest`）
- **辅助**：`tests/helpers.ts` + `tests/helpers/fake-child.ts`（伪造子进程）；多个测试用 `vi.resetModules()` + `vi.stubEnv('HOME', tmpDir)` 隔离配置目录；`tests/fixtures/` 放测试数据。

## 测试规模

`tests/` 下约 55 个测试文件，覆盖 src 全部主要模块。主要分组：

### 入口 / CLI
- `cli.test.ts`：start/stop/status/logs 四子命令端到端（PID 文件、`--server/--token/--api-key` 互斥、`--terminal-*` 选项组、退出码与输出断言）
- `cli-session-manager-injection.test.ts`：验证 startAction 注入 SessionManager + persistence + recoveryClient
- `_sanity.test.ts`：环境自检

### 守护进程 / 生命周期
- `daemon.test.ts`、`daemon-parity.test.ts`、`daemon-multi-runtime.test.ts`、`daemon-kind-dispatch.test.ts`、`daemon-session-lifecycle-wiring.test.ts`、`daemon-session-resume-route.test.ts`、`daemon-spec-root-map.test.ts`、`daemon-interactive-bridge.test.ts`

### 通信
- `hub-client.test.ts`（HTTP lease）、`ws-client.test.ts`、`ws-client-permission-route.test.ts`、`ws-client-session-control.test.ts`、`protocol.contract.test.ts`、`protocol-session-contract.test.ts`、`task-09-hub-client-spec.test.ts`、`task-09-spec-pull-push.test.ts`、`file-rpc.test.ts`

### 任务编排
- `task-runner.test.ts`、`task-runner-retry-timeout.test.ts`、`task-runner-terminal-observer.test.ts`、`task-runner-provider-dispatch.test.ts`、`execution-context.test.ts`、`diff-truncate.test.ts`、`stats-passthrough.test.ts`、`stream-json.test.ts`

### 交互式会话（tests/interactive/，16 个）
- driver：`claude-sdk-driver.test.ts` / `claude-sdk-driver-canuse.test.ts` / `claude-sdk-driver-glm-passthrough.test.ts` / `claude-sdk-driver-permission.test.ts`
- session：`session-manager.test.ts` / `session-manager-pending-cleanup.test.ts` / `session-manager.partial-dedup.test.ts` / `session-manager-permission.test.ts` / `session-concurrent-inject.test.ts` / `session-idle-scanner.test.ts` / `session-interrupt.test.ts` / `session-recovery.test.ts` / `session-store-persistence.test.ts` / `daemon-recovery-boot.test.ts`
- 其他：`input-queue.test.ts`、`permission-resolver.test.ts`

### 模块单元
- `config.test.ts`、`workspace.test.ts`、`credential.test.ts`、`spawn-env.test.ts`、`version.test.ts`、`cursor-version.test.ts`、`types.test.ts`、`cmd-shim.test.ts`、`terminal-launcher.test.ts`、`terminal-observer.test.ts`、`agent-detector.test.ts`、`agent-detector.system-claude.integ.test.ts`
- adapters（tests/adapters/）：`factory.test.ts` / `jsonl.test.ts` / `ndjson.test.ts` / `protocol-adapter.test.ts` / `text.test.ts` / `json-rpc.test.ts`

## 测试约定

- `describe` / `it` / `expect` 显式导入（globals=false）；用 `vi.spyOn` / `vi.mock` / `vi.stubEnv` / `vi.resetModules` 做隔离
- 集成测试（如 `agent-detector.system-claude.integ.test.ts`）单独命名 `.integ.test.ts`
- 测试用例命名用中文陈述句，强调行为与退出码/输出断言
- WS / SDK 等外部依赖用 stub/fake 替换（`WsClient._createSocket` 为 protected 便于测试 stub；SDK driver 测试用 fake query 句柄）

## 运行

```
cd sillyhub-daemon
pnpm test            # 全量
pnpm test:watch      # watch
pnpm vitest run tests/interactive/session-manager.test.ts   # 单文件
```
