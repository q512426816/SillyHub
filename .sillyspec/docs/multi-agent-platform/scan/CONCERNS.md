---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:30Z
created_at: 2026-06-24T00:35:30
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform — 关注点 / 风险（跨组件视角）

> 本文档聚焦跨子项目的技术债、依赖与基础设施风险。各组件内部细节见 `backend/scan/`、`frontend/scan/`、`sillyhub-daemon/scan/`。

## 代码质量

通过 `rg "TODO|FIXME|XXX|HACK"` 扫描三个子项目源码（已排除 `node_modules` / `.venv` / `dist` / `.next` / `.sillyspec`）：

| 子项目 | 扫描路径 | TODO/FIXME/HACK/XXX 数量 |
| --- | --- | --- |
| backend | `backend/app` | 5（全部为 `TODO`，集中在 `app/modules/spec_profile/`） |
| frontend | `frontend/src` | 0 |
| sillyhub-daemon | `sillyhub-daemon/src` | 0（`credential.ts` 的 `XXX` 是占位符文本 `{{USER_XXX}}`，非标记） |

backend 的 5 处 `TODO` 具体位置：

- `backend/app/modules/spec_profile/policy.py:61` — `# TODO: implement stage conflict detection`
- `backend/app/modules/spec_profile/policy.py:97` — `# TODO: implement document conflict detection`
- `backend/app/modules/spec_profile/provider.py:76` — `# TODO: implement actual discovery in follow-up task`
- `backend/app/modules/spec_profile/provider.py:86` — `# TODO: implement actual loading in follow-up task`
- `backend/app/modules/spec_profile/provider.py:96` — `# TODO: implement in follow-up task`

项目约定（`.claude/CLAUDE.md`）：禁止无文档改代码、禁止先写代码再补文档；新功能走 SillySpec 完整流程；hook 拦截禁止跳过；UI 和文档尽量使用中文。

### 🔴 高严重度

- **spec_profile 模块未完成实现**：上述 5 处 `TODO` 集中在 `spec_profile` 的 policy（阶段冲突、文档冲突检测）与 provider（发现、加载）逻辑，均标注为 `follow-up task`，意味着该模块当前为骨架，关键校验逻辑缺失。

### 🟡 中严重度

- **根 `package.json` 为纯占位**：根无脚本聚合，所有命令须进子项目或走 `Makefile`，新开发者容易在根目录直接 `npm test` 触发占位失败（`exit 1`）。
- **daemon 无 CI 工作流**：`.github/workflows/` 下只有 `backend-ci.yml`、`frontend-ci.yml`，daemon 的 65 个测试文件只在本地运行，无自动化回归保障。

### 🟢 低严重度

- frontend 与 sillyhub-daemon 源码当前无 TODO/FIXME 标记，代码层面无明显遗留注释（daemon 唯一命中的 `XXX` 为占位符文本，非标记）。

## 依赖风险

### 🔴 高严重度

- **sillyhub-daemon pnpm overrides 锁定 Claude Agent SDK 多平台子包到 `0.3.181`**（`sillyhub-daemon/package.json` 的 `pnpm.overrides`，覆盖 win32/linux/darwin 的 x64/arm64/musl 共 **8 个平台子包**）。版本硬钉死，升级需同步改 8 条 override，存在与 SDK 新版本不兼容的隐藏风险；同时 `dependencies` 中 `@anthropic-ai/claude-agent-sdk` 直接锁定为 `0.3.181`，主依赖与 override 双重锁死。

### 🟡 中严重度

- **frontend 同时引入 antd 6（`^6.4.4`）+ Tailwind 3.4（`3.4.7`）+ Radix UI（avatar/dialog/dropdown-menu/tooltip）**，样式体系混合，类名/优先级冲突需持续维护；另引入 `@ant-design/nextjs-registry` 做 App Router 集成。
- **frontend 同时声明 `@playwright/test`(1.60) 与 `puppeteer`(24.43) 两套浏览器自动化依赖**，职责重叠，体积与维护负担偏大；且 playwright 无配置文件、E2E 未落地，依赖处于"声明未用"状态。
- **frontend `next` 与 `eslint-config-next` 双双硬钉 `14.2.5`**（非 `^` 范围），Next 14 在 Next 15 已发布的背景下属较早主线版本，升级需同步改两处精确版本。
- **backend 同时依赖 `asyncpg`（生产 PostgreSQL 驱动）与（dev）`aiosqlite`**，测试与生产走不同 async 驱动，存在方言差异风险（CI 环境变量 `DATABASE_URL` 指向 postgres，本地 dev 走 sqlite 时行为可能不一致）。
- **跨平台打包未统一**：daemon 依赖大量平台子包（win32/linux/darwin × x64/arm64/musl），Linux 平台需区分 glibc 与 musl，构建产物分发需按目标平台选择正确子包。

### 🟢 低严重度

- backend 依赖（fastapi、sqlmodel、asyncpg、alembic、redis、structlog 等）多为 `>=` 下限范围，升级空间较宽松；ruff/mypy 为 dev 工具链，影响面可控。

## 部署 / 基础设施风险

### 🟡 中严重度

- **backend Docker 容器不热重载**：backend 容器挂载 `/host-projects` 而非 `/app`、启动命令无 `--reload`，容器跑的是镜像内代码。改后端源码后 docker 不会热重载，新增端点需 rebuild 镜像才能生效（来源：项目记忆 `docker-backend-no-hot-reload`）。
- **frontend Docker healthcheck 误报 unhealthy**：frontend 容器 busybox wget 探针走 Docker 注入的 `http_proxy`、忽略 `no_proxy`，导致 healthcheck 报 unhealthy，但服务实际正常（来源：项目记忆 `docker-frontend-healthcheck-proxy`）。
- **docker compose 两套编排文件并存**：`deploy/docker-compose.yml`（生产）与 `deploy/docker-compose.dev.yml`（开发），配置漂移需同步维护。

### 🟢 低严重度

- backend CI 强制覆盖率门槛 60%（`--cov-fail-under=60`），门槛偏低但已形成基线；测试函数数达 1757，回归面较广。
- 本项目未正式上线（`.claude/CLAUDE.md`），不需要考虑版本迭代兼容，数据可清空，降低了破坏性变更的顾虑。

## daemon kill 通道（interactive / batch 终止契约）

> 本节由 change `2026-08-05-daemon-kill-channel-unify` 补充（task-14 文档同步）。记录 daemon 物理杀进程通道的两层演进：先修 backend→WS 信号层（历史 P0，已修），再统一 daemon 侧硬杀链（本次）。详见该 change 的 `design.md` / `decisions.md`。

### 历史 P0（已修，2026-07-12~14）

- ✅ **P0-1 backend cancel 信号未真发 WS**：`cancel_lease` 曾走 `_ws_cancel_stub` 占位（不发真实 WS 信号）。修于 commit `d06d9a32`（2026-07-12）——改走 `_send_interactive_cancel`，真实下发 `SESSION_INTERRUPT` / `SESSION_END`。
- ✅ **P0-2 MissionControl.cancel 未委派 lease 取消链**：曾不进 `cancel_lease`。修于 commit `9e4faf06` / `372e52d8`（2026-07-14）——`MissionControl.cancel` 委派 `cancel_lease`，闭合 backend→WS 信号层。

> 这两层只解决"backend 终止信号有没有发出"。下一层"daemon 收到信号后子进程有没有真停"仍存在 4 个缺口（design §1 隐患 1~4：Claude 不调 query.close、Codex END 不主动收口、batch kill 靠心跳轮询、budget 无运行期强制点），由本次 change 统一补齐。

### 本次新机制（统一 daemon 物理杀进程，change `2026-08-05-daemon-kill-channel-unify`，未提交）

- **Claude END/fail 接通 SDK kill 链（task-01，D-003 / D-004）**：`ClaudeDriverHandle` 新增 `close = () => query.close()`（`sillyhub-daemon/src/interactive/claude-sdk-driver.ts:397`），触发 SDK 内部 `stdin EOF → 2s 宽限 → SIGTERM → 5s → SIGKILL`（`sdk.mjs` close / `vB=2000`），~7s 内强杀卡死 turn 的 claude 子进程。`session-manager.ts` 新增私有 `_terminateSession(state, reason)` 统一收口 `end()` / `fail()`，按 provider 分流取 target（**claude → `state.query`、codex → `state.driverHandle`**，session-manager.ts:2164-2167），`terminateTarget?.close?.()` 包 try/catch 兜底（R-01）。`interrupt()` 不动（守"打断本轮"软语义，D-001@v2）。
- **interactive cancel_lease 改发 SESSION_END 硬杀（task-02，D-001@v2）**：原对 interactive 发 `SESSION_INTERRUPT`（软，daemon 只 `q.interrupt()` 不杀进程，卡死 turn 仍僵尸）；改发 `SESSION_END` → 走 `_terminateSession` 硬杀链。`SESSION_INTERRUPT` 此后**仅**对应"打断本轮"按钮（interruptSession 端点）。
- **batch cancel_lease 走 LEASE_CANCEL WS 即时通道（task-04 / task-05，FR-03 / R-06）**：新增 WS 消息 `daemon:lease_cancel`（双端 `backend/app/modules/daemon/protocol.py` `DAEMON_MSG_LEASE_CANCEL` + `sillyhub-daemon/src/protocol.ts` `MSG.LEASE_CANCEL`）。backend 标记 cancelled 后经 `ws_hub.send_to_runtime` best-effort 推送，daemon 收到调 `taskRunner.cancel(leaseId)` 复用现有 `AbortController → _killChild` 即时杀 batch 子进程，不再等心跳周期；发送失败靠现有心跳轮询兜底（task-runner.ts:905 不变）。双触发幂等由 `taskRunner.cancel` 内部保证。
- **budget_tokens 运行期软切断检查点（task-08，D-006 / D-009）**：backend 把 `AgentMission.budget_tokens`（`backend/app/modules/agent/model.py:595`）经 claim payload 开放 dict（`LeaseClaimResponse.payload`，`additionalProperties:true`）下发（`backend/app/modules/daemon/lease/context.py` task-07 双写 `budget_tokens` / `budgetTokens`，非 OpenAPI 命名 schema 字段）；daemon `LeaseCtx.budget_tokens?: number`（`sillyhub-daemon/src/types.ts:431`）接收，执行循环累计 `input_tokens + output_tokens`（per AgentRun，不含 cache）≥ 阈值 → 设 `overBudget` → 当前 turn / step 跑完后不续（软切断，D-006，不丢当前 turn 工作）+ 经 `notifyRunResult` / `submit_lease_messages` 回传 `budget_exceeded` reason + usage。
- **terminating_at 执行端可见性 + 30s sweeper（task-10 / task-11，D-007）**：`DaemonTaskLease.terminating_at: datetime | None`（`backend/app/modules/daemon/model.py` + Alembic migration `20260805_lease_terminating_at`）。写入点：仅 `cancel_lease`（`lease_service.py:419`）写——`end_session` 同事务即把 lease 置 `completed` 无观测窗口（XC-03），session 维度不另设字段（XC-04，cancel_lease 已同步 session.status='ended'）。清空点：daemon 回传 `complete_lease`（`lease/service.py:307`）/ `end_session` 收敛（`session/service.py:934`）时清。独立 sweeper `alert_stuck_terminating_leases`（`lease_service.py:285`，`TERMINATING_TIMEOUT_SECONDS=30`）查 `terminating_at IS NOT NULL AND terminating_at < now-30s` 告警 + 返回 lease_id 列表（不并入 `expire_overdue_leases`——后者只扫 `status='claimed'`，XC-08；不改 lease.status、不重试、不引入 outbox，D-007）。

> 双端 WS 消息变化（LEASE_CANCEL 新增 / SESSION_END 扩大 / SESSION_INTERRUPT 收窄）见 `INTEGRATIONS.md` §2.1。

## 已知问题清单（按严重度分组）

### 🔴 高（阻塞 / 待 execute）

- 🔴 **spec_profile 关键校验缺失**：阶段冲突、文档冲突、provider 发现/加载逻辑均标注 `follow-up task`，模块为骨架态。
- 🔴 **agent-run 链路日志丢失**：`AgentRunLog` 模型无 `metadata` 列，三层日志的 `metadata` 在 `submit_messages` 丢失，端到端 scan 联调待环境（来源：项目记忆 `agent-run-pipeline-fix-status`）。
- 🔴 **daemon turn 卡死**：根因是 `cli.ts` 漏传 `persistence` / `recoveryClient`，交互式 turn 无法恢复，修复方案见 `fix-interactive-daemon-lifecycle` design §11 / tasks W4，execute 待办（来源：项目记忆 `daemon-restart-session-recovery-fix`）。

### 🟡 中（待联调 / 待 verify / 运维注意）

- 🟡 **agent-run 调度 scan 链路 CONDITIONAL_PASS**：单元测试通过，端到端联调待环境验证（来源：`agent-run-pipeline-fix-status`）。
- 🟡 **多 Agent 编排 `delegate_task` spike 待运行时验证**：Wave0 已修 + 通用兜底已落地，但 delegate_task 运行时行为尚未实测（来源：`multi-agent-orchestration-status`）。
- 🟡 **daemon-service-split 已 merge，遗留项待 verify**：D-005（facade lazy import）、D-006（跨域 `_facade` 引用）尚未 verify（来源：`daemon-service-split-status`）。
- 🟡 **多个 daemon 实例并存**：本地与远程两类实例同时存在，停 daemon 时必须按 `--server` 区分，避免误杀（来源：`multi-daemon-instances`）。
- 🟡 **commit hook 可被复合命令绕过**：`git add && git commit` 以 `git add` 开头会绕过 claude PreToolUse 层（仅触发 git pre-commit 的 ruff，不触发 mypy + 前端全量检查）（来源：`pre-commit-ci-check-hook`）。
- 🟡 **claude.exe 孤儿进程**：禁止 `taskkill /IM` 通杀（会自杀当前会话），必须按 PID 精确杀并排除当前会话（来源：`claude-exe-orphan-cleanup`）。

### 🟢 低（已知限制 / 增强）

- 🟢 **daemon 无自动拉起机制**：daemon 挂掉后不会自动重启，需手动启动（来源：`multi-daemon-instances`）。
- 🟢 **根 package.json 为纯占位**：根无脚本聚合，所有命令须进子项目或走 `Makefile`。
