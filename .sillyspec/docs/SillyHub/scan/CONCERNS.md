---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:59Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:59
---

# SillyHub — 关注点 / 风险

> 基于对三个子项目源码的 `grep`（TODO/FIXME/HACK/XXX）扫描、`.claude/CLAUDE.md` 硬性规则、
> 以及项目记忆（`.claude/.../memory/MEMORY.md`）中的真实已知问题汇总。

## 代码质量

通过 `grep -rn "TODO|FIXME|HACK|XXX"` 扫描三个子项目源码（已排除 `node_modules` / `.venv` / `dist` / `.next`）：

| 子项目 | 扫描路径 | TODO/FIXME/HACK/XXX 数量 |
| --- | --- | --- |
| backend | `backend/app` | 5（全部为 `TODO`，集中在 `app/modules/spec_profile/`） |
| frontend | `frontend/src` | 0 |
| sillyhub-daemon | `sillyhub-daemon/src` | 0 |

backend 的 5 处 `TODO` 具体位置：

- `backend/app/modules/spec_profile/policy.py:61` — `# TODO: implement stage conflict detection`
- `backend/app/modules/spec_profile/policy.py:97` — `# TODO: implement document conflict detection`
- `backend/app/modules/spec_profile/provider.py:76` — `# TODO: implement actual discovery in follow-up task`
- `backend/app/modules/spec_profile/provider.py:86` — `# TODO: implement actual loading in follow-up task`
- `backend/app/modules/spec_profile/provider.py:96` — `# TODO: implement in follow-up task`

> 说明：`sillyhub-daemon/src/credential.ts` 中出现的 `XXX` 是占位符 `{{USER_XXX}}` 文本，非标记，不计入。

项目约定（`.claude/CLAUDE.md`）：禁止无文档改代码、禁止先写代码再补文档；新功能走 SillySpec 完整流程；hook 拦截禁止跳过。

### 🔴 高严重度

- **spec_profile 模块未完成实现**：上述 5 处 `TODO` 集中在 `spec_profile` 的 policy（阶段冲突、文档冲突检测）与 provider（发现、加载）逻辑，均为 `follow-up task`，意味着该模块当前为骨架，关键校验逻辑缺失。

### 🟡 中严重度

- **根 `package.json` 为纯占位**：根无脚本聚合，所有命令须进子项目或走 `Makefile`，新开发者容易在根目录直接 `npm test` 触发占位失败。

### 🟢 低严重度

- frontend 与 sillyhub-daemon 源码当前无 TODO/FIXME 标记，代码层面无明显遗留注释。

## 依赖风险

### 🔴 高严重度

- **sillyhub-daemon pnpm overrides 绑定 Claude Agent SDK 多平台子包到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`**（`sillyhub-daemon/package.json` 的 `pnpm.overrides`，覆盖 win32/linux/darwin 的 x64/arm64/musl 共 8 个平台子包）。版本硬钉死，升级需同步改 8 条 override，存在与 SDK 新版本不兼容的隐藏风险。

### 🟡 中严重度

- **frontend 同时引入 antd 6 + Tailwind 3.4 + Radix UI**，样式体系混合，类名 / 优先级冲突需持续维护。
- **frontend 同时声明 `@playwright/test`(1.60) 与 `puppeteer`(24.43) 两套浏览器自动化依赖**，职责重叠，体积与维护负担偏大。
- **backend 同时依赖 `asyncpg` 与（dev）`aiosqlite`**，测试与生产走不同 async 驱动，存在方言差异风险。

## 已知问题清单（按严重度分组）

> 来源：项目记忆 `.claude/.../memory/MEMORY.md` 索引项。

### 🔴 高（阻塞 / 待 execute）

- 🔴 **agent-run 链路日志丢失**：`AgentRunLog` 模型无 `metadata` 列；三层日志的 `metadata` 在 `submit_messages` 丢失。端到端 scan 联调待环境。（来源：项目记忆 `agent-run-pipeline-fix-status`）
- 🔴 **daemon turn 卡死**：根因是 `cli.ts` 漏传 `persistence` / `recoveryClient`，导致交互式 turn 无法恢复。修复方案见 `fix-interactive-daemon-lifecycle` design §11 / tasks W4，**execute 待办**。（来源：项目记忆 `daemon-restart-session-recovery-fix`）
- 🔴 **daemon 重启 session 恢复修复尚未 execute**：同上，design 与 tasks 已就绪但代码未落地。

### 🟡 中（待联调 / 待 verify / 运维注意）

- 🟡 **agent-run 调度 scan 链路 CONDITIONAL_PASS**：单元测试通过，但端到端联调待环境验证。（来源：`agent-run-pipeline-fix-status`）
- 🟡 **多 Agent 编排 `delegate_task` spike 待运行时验证**：Wave0 已修 + 通用兜底已落地，但 delegate_task 的运行时行为尚未实测。（来源：`multi-agent-orchestration-status`）
- 🟡 **daemon-service-split 已 merge，遗留项待 verify**：D-005（facade lazy import）、D-006（跨域 `_facade` 引用）尚未 verify。（来源：`daemon-service-split-status`）
- 🟡 **多个 daemon 实例并存**：本地（`daemon-start.bat`）与远程（手动 cmd）两类实例同时存在，停 daemon 时必须按 `--server` 区分，避免误杀。（来源：`multi-daemon-instances`）
- 🟡 **commit hook 可被复合命令绕过**：`git add && git commit` 复合命令以 `git add` 开头，会绕过 claude PreToolUse 层（仅触发 git pre-commit 的 ruff，不触发 mypy + 前端全量检查）。（来源：`pre-commit-ci-check-hook`）
- 🟡 **claude.exe 孤儿进程**：禁止 `taskkill /IM` 通杀（会自杀当前会话），必须按 PID 精确杀并排除当前会话。（来源：`claude-exe-orphan-cleanup`）

### 🟢 低（已知限制 / 增强）

- 🟢 **daemon 无自动拉起机制**：daemon 挂掉后不会自动重启，需手动启动。（来源：`multi-daemon-instances`）
- 🟢 **根 package.json 为纯占位**：根无脚本聚合，所有命令须进子项目或走 `Makefile`。
