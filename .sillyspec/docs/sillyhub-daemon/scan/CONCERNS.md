---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 关注点（Concerns）

> 2026-08-18 全量重扫（源码 744e3de4）。仅列本轮 grep/read 可核实的问题；上一版（6e78b29a）中已无法在本目录内核实或属 backend 侧的条目（如 backend `_ws_cancel_stub` 空桩）不在此列。

## 代码质量

### 🔴 高（维护性 / 正确性）

- **三个 3000+ 行 god 文件**：`src/daemon.ts` 4047 行、`src/interactive/session-manager.ts` 3897 行、`src/task-runner.ts` 3156 行（wc -l 实测）。高耦合、跨文件契约靠约定，无低风险切片路径；改动任一都需大范围定向回归（对应 tests/ 顶层 81 + interactive 36 个测试文件）。

### 🟡 中（债务 / 边界）

- **local.yaml 写入非原子**：`src/local-yaml-writer.ts:121` 直接 `await fs.writeFile(join(rootPath, '.sillyspec', 'local.yaml'), text, 'utf8')`，无 tmp+rename 两段式——进程在写中途崩溃/断电会留下半截文件，而该文件承载 platform/mcp 配置（token 上行），损坏后 daemon 起不来需人工修。
- **`--passWithNoTests` 掩盖 include 回归**：`pnpm test` = `vitest run --passWithNoTests`（package.json scripts）。当前实际有 141 个测试文件、不构成零测试风险；但若 `vitest.config.ts` 的 include 模式被误改/路径拼错，套件会以 0 个测试**静默全绿**而非报错。

### 🟢 低 / 已核实无虞

- **Windows 路径处理干净**：grep `src/` 未发现反斜杠字符串拼接路径（`\ + '\...'` 零命中），路径一律走 node:path join/resolve；跨平台风险主要在测试真实 I/O 的磁盘争用（已由 maxForks=8 缓解，见 TESTING.md）。
- **ws 重连边界已核实**：`src/ws-client.ts` 固定 `RECONNECT_INTERVAL_MS = 5_000`（L32）单一定时器重连，无指数退避/抖动；ping 后等 pong 超时则 `terminate()` 走既有 close→reconnect 链（L51/L618）；重连 timer 有 clearTimeout + unref 配对（L586-601）。行为可预期，长时间断网每 5s 一次重试属可接受压力。
- **vitest.config.ts 注释漂移**：注释写「84 个测试文件」，实际已 141 个（Glob 实数）——纯注释陈旧，不影响行为，按「注释与实现不一致及时修正」原则顺手改。

## 依赖风险

### 🟡 中（升级联动面）

- **`@anthropic-ai/claude-agent-sdk` 钉死 `0.3.181` + 8 条 pnpm overrides 联动**：package.json `pnpm.overrides` 把 win32-x64/arm64、linux-x64/arm64/x64-musl/arm64-musl、darwin-x64/arm64 共 8 个平台包子包全部 override 到主包同版本。升级需**同时**改 dependencies 版本 + 8 条 overrides，漏一条导致对应平台解析失败；另 0.x 阶段 API 可能破坏性变更（driver 封装需跟随，`tests/interactive/claude-sdk-driver*.test.ts` 是回归面）。
- **zod ^4.4.3 单点消费 + MCP SDK 组合**：grep 核实 `src/` 仅 `mcp-server.ts` 一处 import zod。zod v4 是主版本（API 与 v3 不兼容），与 `@modelcontextprotocol/sdk ^1.29.0` 的组合依赖 SDK 对 zod4 schema 的支持；升级任一方必须跑 `tests/mcp-server.test.ts` + `tests/mcp-config.test.ts` 验证 MCP 工具契约未破。

### 🟢 低（对齐良好 / 仅版本事实）

- **MCP SDK 与 backend 版本线对齐**：daemon `@modelcontextprotocol/sdk ^1.29.0`（package.json）与 backend `pyproject.toml` 的 `"mcp>=1.29,<2"`（L34）同在 1.x 线；backend 升 mcp 2.x 时 daemon 需同步评估。
- **commander ^12.1.0 / js-yaml ^4.1.0**：均为老稳定大版本（commander 已有更高 major，js-yaml 4.x 仍是当前 major）；本轮只登记版本事实，未见升级压力。
- **运行时钉死**：`engines.node >= 20` + `packageManager: pnpm@9.6.0`（依赖 AbortSignal.timeout / 原生 fetch 等 Node 20 API）；Node 18 及以下不可用，pnpm 版本漂移可能破坏 lockfile 一致性。
