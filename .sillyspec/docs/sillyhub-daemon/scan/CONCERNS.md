---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:48Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:48
---

# sillyhub-daemon · 风险与债务

> 🔴 高 / 🟡 中 / 🟢 低 三级。基于源码与配置 grep 验证的事实。

## 代码质量

- 🟡 **Python→TS 重写的历史映射注释残留**：`src/config.ts`、`src/hub-client.ts`、`src/adapters/index.ts` 等大量文件中仍保留"对齐 Python `xxx`"、"等价 Python `DEFAULT_CONFIG_DIR`"、"对齐 Python httpx.AsyncClient(timeout=30.0)"等映射注释。当前已是纯 TS 实现，这些注释属于 task-21 重写期的对照说明，长期保留会增加阅读负担、误导新成员以为仍是 Python。建议择机批量清理。
- 🟡 **task 编号 / spike 结论散落注释**：源码注释中引用 `task-04 §4.2` / `task-05` / `task-07 (FR-06 / D-004@v1)` / `task-08 (D-007@v1 / FR-07)` / `task-09` / `task-10` / `task-19` / `task-21` / `task-22` / `spike H2` / `spike D1/D3/D4` 等。变更归档后这些引用会与实际文档脱节，缺少稳定索引。
- 🟢 **错误类集中度不一**：交互式域错误类集中在 `interactive/types.ts`（好），但 `GitError` 在 workspace.ts、`HubHttpError` 在 hub-client.ts、`RpcError` 在 ws-client.ts、`ClaudeExecutableNotFoundError` 在 claude-sdk-driver.ts 各自就近定义，未统一到一个 errors 模块。当前规模可接受。
- 🟢 **README 已更新为 Node.js**：`README.md` 顶部明确标注当前实现是 Node.js / TypeScript，安装/命令/排错均已是 pnpm/tsc/vitest，Python 仅在"卸载旧残留"小节出现（合理）。
- 🟢 **无 TODO/FIXME/XXX 残留**：grep src/ 未发现显式债务标记（仅 credential.ts 的"占位符"为业务术语误报）。

## 依赖风险

- 🔴 **Claude Agent SDK 版本强耦合 + win32 平台分发 hack**：`package.json` 把 `@anthropic-ai/claude-agent-sdk` 钉死在精确版本 `0.3.181`（非 `^`），并通过 `pnpm.overrides` 把 8 个平台 optional package 统一重定向到主包。这表明 SDK 0.3.x 仍快速演进、平台 native 二进制分发不稳定；升级 SDK 需同步改 8+ 行 overrides，容易漏改导致某平台拉到错版本。
- 🟡 **SDK 0.3.x 仍处早期**：claude-sdk-driver.ts 的注释大量依赖 spike 结论（`spike H2 实测签名 query({ prompt: AsyncIterable, options })`、`spike D1：interrupt 是 turn 级`、`spike D3：resume 按 cwd 分目录`）。SDK API 在 0.x 阶段可能频繁破坏性变更，driver 封装需持续跟随。
- 🟡 **Node 20 原生 fetch 行为依赖**：hub-client.ts 依赖 Node 20 fetch 的两个隐式行为——"不读 HTTP_PROXY"（等价旧 Python `trust_env=False`）和"无连接池"。这两个行为随 Node 版本可能变化。
- 🟢 **依赖精简**：运行时依赖仅 3 个（claude-agent-sdk / commander / ws），dev 仅 2 类（@types/node / @types/ws + typescript + vitest），无冗余框架，升级面小。
- 🟢 **Node ≥20 engines 约束**：package.json `engines.node` 要求 ≥20，与 fetch / AbortSignal.timeout 等依赖匹配，约束清晰。

## 配置/文档同步债务

- 🔴 **`.sillyspec/local.yaml` 的 daemon 命令可能过时**：若仍是 `pip install -e .` / `python -m pytest tests/` / `ruff check .`，则实际应为 `pnpm install && pnpm build` / `pnpm test` / `pnpm typecheck`。需核对 sillyspec 的 daemon 构建/测试/lint 命令是否已切到 pnpm。
- 🔴 **`.sillyspec/projects/sillyhub-daemon.yaml` 的 role 字段需核对**：若仍写"Python 3.12 + httpx + websockets + Click CLI"，应改为"本地守护进程 - Node.js/TypeScript + Claude Agent SDK + ws + commander"。
- 🟡 **README 排错段引用 Python 残留**：README 故障排查段仍包含"`pip uninstall -y sillyhub-daemon`"、"删掉残留的 sillyhub-daemon.exe"等内容——这是为旧 Python 用户提供迁移指引，合理但应在若干版本后移除。

## 运维与已知坑（当前状态）

- 🟢 **daemon 重启 turn 卡死已修复（gap-8.3）**：MEMORY 中记录的"cli.ts 漏传 persistence/recoveryClient 致 daemon 重启后 turn 卡死"已在源码落地——`src/cli.ts` 第 412-449 行 `startAction` 中已构造 `const persistence = new JsonSessionPersistence()` 并在 `new Daemon({...})` 时注入 `persistence` 与 `recoveryClient: client`（`HubClient` 实现 `RecoveryCoordinator`）。配套测试 `cli-session-manager-injection.test.ts` 守护该注入关系。该项可视为已闭合，MEMORY 待同步更新。
- 🟡 **多 daemon 实例需手动按 `--server` 区分停机**：本机可能同时存在"连本地 backend"（`daemon-start.bat`）与"连远程 backend"（手动 cmd）两类 daemon 实例，无自动拉起/识别机制；停 daemon 须按 `--server` 区分别误杀（参见 MEMORY `multi-daemon-instances`）。`stop` 子命令读单一 `daemon.pid`，多实例场景下 PID 文件会互相覆盖，是潜在踩坑点。
- 🟡 **ESM/CJS 互操作风险**：本项目是纯 ESM（`type:module` + NodeNext）。若未来引入 CJS 依赖或被 CJS 工具链消费，`verbatimModuleSyntax` + NodeNext 解析会对 default/named interop 较敏感；当前运行时依赖（claude-agent-sdk / commander / ws）均提供 ESM 入口，无实际问题。

## 其他

- 🟢 **测试覆盖较全**：tests/ 下约 55 个测试文件覆盖所有主要模块（含 interactive 全栈 16 个、WS permission/session 控制路由、daemon 启动恢复、cli SessionManager 注入守护），债务面不大。
