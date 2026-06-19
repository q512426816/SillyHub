---
author: qinyi
created_at: 2026-06-19 12:50:59
source_commit: 0303536
updated_at: 2026-06-19T04:50:59Z
generator: sillyspec-scan
---

# sillyhub-daemon · 风险与债务

> 🔴 高 / 🟡 中 / 🟢 低 三级。基于源码与配置 grep 验证的事实。

## 代码质量

- 🟡 **Python→TS 重写的历史映射注释残留**：`src/config.ts`、`src/hub-client.ts`、`src/adapters/index.ts` 等大量文件中仍保留"对齐 Python `xxx`"、"等价 Python `DEFAULT_CONFIG_DIR`"、"对齐 Python httpx.AsyncClient(timeout=30.0)"、"对齐 Python `PROVIDERS`"等映射注释。当前已是纯 TS 实现，这些注释属于 task-21 重写期的对照说明，长期保留会增加阅读负担、误导新成员以为仍是 Python。建议择机批量清理（保留必要的语义说明，删掉 Python 引用）。
- 🟡 **测试 describe 名沿用 Python 旧标签**：`tests/cli.test.ts` 中 describe 名为 `TestStatus (test_cli.py)` / `TestStop (test_cli.py)` / `TestLogs (test_cli.py)` / `TestStart (test_cli.py)`，源自旧 Python pytest 套件迁移，与当前 vitest 实现脱节，建议改成符合当前实现的命名。
- 🟡 **task 编号 / spike 结论散落注释**：源码注释中引用 `task-04 §4.2` / `task-05` / `task-07 (FR-06 / D-004@v1)` / `task-08 (D-007@v1 / FR-07)` / `task-09` / `task-10` / `task-19` / `task-21` / `task-22` / `spike H2` / `spike D1/D3/D4` 等。变更已归档后这些引用会与实际文档脱节，缺少稳定索引。
- 🟢 **错误类集中度不一**：交互式域错误类集中在 `interactive/types.ts`（好），但 `GitError` 在 workspace.ts、`HubHttpError` 在 hub-client.ts、`RpcError` 在 ws-client.ts、`ClaudeExecutableNotFoundError` 在 claude-sdk-driver.ts 各自就近定义，未统一到一个 errors 模块。当前规模可接受，后续可考虑聚合。
- 🟢 **README 已更新为 Node.js**：`README.md` 顶部明确标注"当前实现是 Node.js / TypeScript（曾经是 Python，已在 task-21 重写为 TS）"，安装/命令/排错均已是 pnpm/tsc/vitest，Python 仅在"卸载旧残留"小节出现（合理）。

## 依赖风险

- 🔴 **Claude Agent SDK 版本强耦合 + win32 平台分发 hack**：`package.json` 把 `@anthropic-ai/claude-agent-sdk` 钉死在精确版本 `0.3.181`（非 `^`），并通过 `pnpm.overrides` 把 8 个平台 optional package（`@anthropic-ai/claude-agent-sdk-{win32,linux,darwin}-{x64,arm64}[-musl]`）统一重定向到主包。这表明 SDK 0.3.x 仍快速演进、平台 native 二进制分发不稳定；升级 SDK 需同步改 8+ 行 overrides，容易漏改导致某平台拉到错版本。
- 🟡 **SDK 0.3.x 仍处早期**：claude-sdk-driver.ts 的注释大量依赖 spike 结论（`spike H2 实测签名 query({ prompt: AsyncIterable, options })`、`spike D1：interrupt 是 turn 级`、`spike D3：resume 按 cwd 分目录`）。SDK API 在 0.x 阶段可能频繁破坏性变更，driver 封装需持续跟随。
- 🟡 **Node 20 原生 fetch 行为依赖**：hub-client.ts 依赖 Node 20 fetch 的两个隐式行为——"不读 HTTP_PROXY"（等价旧 Python `trust_env=False`）和"无连接池"。这两个行为随 Node 版本可能变化（未来 Node 若支持代理环境变量或引入连接池，语义会变）。
- 🟢 **依赖精简**：运行时依赖仅 3 个（claude-agent-sdk / commander / ws），dev 仅 2 类（@types/node / vitest），无冗余框架，升级面小。
- 🟢 **Node ≥20 engines 约束**：package.json `engines.node` 要求 ≥20，与 fetch / AbortSignal.timeout 等依赖匹配，约束清晰。

## 配置/文档同步债务

- 🔴 **`.sillyspec/local.yaml` 的 daemon 命令过时**：仍是 `pip install -e .` / `python -m pytest tests/` / `ruff check .`，实际应为 `pnpm install && pnpm build` / `pnpm test` / `pnpm typecheck`。sillyspec 的 daemon 构建/测试/lint 命令全部失效。
- 🔴 **`.sillyspec/projects/sillyhub-daemon.yaml` 的 role 过时**：`role` 字段仍写"本地守护进程 - Python 3.12 + httpx + websockets + Click CLI"，与实际 Node.js + Claude Agent SDK 完全不符。需改为"本地守护进程 - Node.js/TypeScript + Claude Agent SDK + ws + commander"。
- 🟡 **README 排错段引用 Python 残留**：README 故障排查段仍包含"`pip uninstall -y sillyhub-daemon`"、"删掉残留的 sillyhub-daemon.exe"等内容——这是为旧 Python 用户提供迁移指引，合理但应在若干版本后移除。

## 其他

- 🟢 **测试覆盖较全**：tests/ 下约 55 个测试文件覆盖所有主要模块（含 interactive 全栈、WS permission/session 控制路由、daemon 启动恢复），债务面不大。
- 🟢 **无 TODO/FIXME/XXX/@deprecated 残留**：grep 源码未发现显式债务标记（仅 credential.ts 的"占位符"为业务术语误报）。
