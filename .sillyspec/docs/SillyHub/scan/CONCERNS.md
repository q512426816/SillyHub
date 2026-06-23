---
source_commit: ba87eec
updated_at: 2026-06-23T16:32:31Z
created_at: 2026-06-24T00:32:31
author: qinyi
generator: sillyspec-scan
---

# SillyHub — 关注点 / 风险

> 基于 `rg`（TODO/FIXME/HACK/XXX）扫描三个子项目源码、`backend/pyproject.toml` / `frontend/package.json` / `sillyhub-daemon/package.json` 依赖声明、`.claude/CLAUDE.md` 硬性规则、以及项目记忆（MEMORY.md 索引）真实已知问题汇总。只记录可验证事实。

## 代码质量

通过 `rg -n "TODO|FIXME|XXX|HACK"` 扫描（已排除 `node_modules` / `.venv` / `dist` / `.next`）：

| 子项目 | 扫描路径 | TODO/FIXME/HACK/XXX 数量 |
| --- | --- | --- |
| backend | `backend/app` | 5（全部 TODO，集中在 `spec_profile/`） |
| frontend | `frontend/src` | 0 |
| sillyhub-daemon | `sillyhub-daemon/src` | 0 |

backend 5 处 `TODO` 具体位置：

- `backend/app/modules/spec_profile/policy.py:61` — `# TODO: implement stage conflict detection`
- `backend/app/modules/spec_profile/policy.py:97` — `# TODO: implement document conflict detection`
- `backend/app/modules/spec_profile/provider.py:76` — `# TODO: implement actual discovery in follow-up task`
- `backend/app/modules/spec_profile/provider.py:86` — `# TODO: implement actual loading in follow-up task`
- `backend/app/modules/spec_profile/provider.py:96` — `# TODO: implement in follow-up task`

> 说明：`sillyhub-daemon/src/credential.ts` 出现的 `XXX` 是占位符 `{{USER_XXX}}` 文本，非标记，不计入。

项目约定（`.claude/CLAUDE.md`）：禁止无文档改代码、禁止先写代码再补文档；新功能走 SillySpec 完整流程；hook 拦截禁止跳过需解决问题再提交；UI/文档尽量中文。

### 🔴 高严重度

- **spec_profile 模块关键逻辑未实现**：上述 5 处 TODO 集中在 spec_profile 的 policy（阶段冲突、文档冲突检测）与 provider（发现、加载）逻辑，均标注 `follow-up task`，模块当前为骨架，校验逻辑缺失。

### 🟡 中严重度

- **根 `package.json` 为纯占位**：根无脚本聚合，所有命令须进子项目或走 `Makefile`，新开发者易在根目录直接 `npm test` 触发占位失败。
- **commit hook 可被复合命令绕过**：`git add && git commit` 以 `git add` 开头会绕过 claude PreToolUse 层（仅触发 git pre-commit 的 ruff，不触发 mypy + 前端全量检查）。（来源：MEMORY `pre-commit-ci-check-hook`）

### 🟢 低严重度

- frontend 与 sillyhub-daemon 源码当前无 TODO/FIXME/HACK 标记，代码层面无明显遗留注释。

## 依赖风险

### 🔴 高严重度

- **sillyhub-daemon pnpm overrides 硬钉 Claude Agent SDK 多平台子包**：`sillyhub-daemon/package.json` 的 `pnpm.overrides` 将 win32/linux/darwin 的 x64/arm64/musl 共 **8 个平台子包**全部绑定到 `npm:@anthropic-ai/claude-agent-sdk@0.3.181`，主依赖 `@anthropic-ai/claude-agent-sdk` 也硬钉 `0.3.181`。升级需同步改 8 条 override + 主依赖，存在与 SDK 新版本不兼容的隐藏风险。

### 🟡 中严重度

- **frontend 同时引入 antd 6 + Tailwind 3.4 + @xyflow/react**（`antd ^6.4.4` / `tailwindcss 3.4.7` / `@xyflow/react ^12.10.2`），样式体系混合（双 UI 风格 + 自定义图库），类名 / 优先级冲突需持续维护。
- **frontend 同时声明 `@playwright/test` ^1.60 与 `puppeteer` ^24.43** 两套浏览器自动化依赖，职责重叠，体积与维护负担偏大，且仓库内无独立 playwright config。
- **backend 同时依赖 `asyncpg`（生产）与（dev）`aiosqlite`**，测试与生产走不同 async 驱动，存在方言差异风险（如 JSONB / 数组 / UPSERT 语法）。
- **frontend 锁定 `next 14.2.5` / `react 18.3.1`**，App Router 14 为当前稳定线，但 Next 15 已发布，升级需评估 RSC / 缓存语义变化。

### 🟢 低严重度

- backend dev 依赖齐全（pytest 系列、aiosqlite、httpx 测试客户端），无明显缺失。
- daemon Node 原生 `fetch` 零 HTTP 库依赖（仅 `ws` + `commander` + claude-agent-sdk），依赖面小。

## 架构风险（已知问题清单，按严重度分组）

> 来源：项目记忆 `.claude/.../memory/MEMORY.md` 索引项 + 扫描观察。

### 🔴 高（阻塞 / 待 execute）

- 🔴 **daemon turn 卡死 + 重启 session 恢复未 execute**：根因 `cli.ts` 漏传 `persistence` / `recoveryClient`，交互式 turn 无法恢复；design 与 tasks 已就绪但代码未落地。（来源：`daemon-restart-session-recovery-fix` / `fix-interactive-daemon-lifecycle`）

### 🟡 中（运维注意 / 待联调）

- 🟡 **Docker 后端不热重载**：backend 容器挂载 `/host-projects` 非 `/app`、无 `--reload`，跑镜像内代码；改后端源码后需 rebuild 镜像才能生效。（来源：`docker-backend-no-hot-reload`）
- 🟡 **Docker frontend healthcheck 误报**：busybox wget 走 Docker 注入的 `http_proxy`、忽略 `no_proxy` 致 unhealthy，服务实际正常。（来源：`docker-frontend-healthcheck-proxy`）
- 🟡 **daemon 跨平台打包复杂**：8 个平台子包 override + musl 变体，Windows/macOS/Linux 交叉打包链路长，任一平台 SDK 子包缺失即安装失败。
- 🟡 **后端改完必实测 API**：历史上有 import 缺失（如未 import UTC）致 API 500、前端看板空的问题，约定后端改动后 curl 实测端点 + grep 确认 import 在当前文件。（来源：`backend-change-must-test-api`）
- 🟡 **多个 daemon 实例并存**：本地与远程实例同时存在，停 daemon 必须按 `--server` 区分避免误杀。（来源：`multi-daemon-instances`）

### 🟢 低（已知限制 / 增强）

- 🟢 **daemon 无自动拉起机制**：挂掉后不自动重启，需手动启动。
- 🟢 **本项目未正式上线**：按 `.claude/CLAUDE.md` 约定无需考虑版本迭代兼容，数据可清空，迁移脚本可破坏性变更。
