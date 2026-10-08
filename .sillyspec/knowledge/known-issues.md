---
author: qinyi
created_at: 2026-06-23 02:00:00
---

# 已知坑 (Known Issues)

## 🟡 sillyhub-daemon 于 2026-06-14 从 Python 重写为 Node.js

`scripts/`、旧文档、部分模块卡片可能仍引用 Python 文件名（`daemon.py` / `agent_detector.py` / `task_runner.py`），实际代码已全部是 TypeScript（`daemon.ts` / `agent-detector.ts` / `task-runner.ts`，ESM/pnpm）。改 daemon 前确认看的是 `.ts` 源码，勿被旧 Python 文档误导。

## 🔴 CI hook 复合命令可绕过 claude PreToolUse 层

两层 hook：claude `PreToolUse`（`git commit*` 前缀匹配 → 全量 mypy + frontend）+ git `pre-commit`（ruff）。坑：`git add && git commit` 这类**以 `git add` 开头的复合命令**会绕过 claude 层，只跑 ruff。需要全量检查时，应分开执行 `git add` 再 `git commit`，或单独触发。

## 🟢 daemon 重启 session 恢复已修复（gap-8.3 / commit 40e21d3）

daemon 重启后 interactive session 丢失致 turn 卡死的根因（`sillyhub-daemon/src/cli.ts` 漏传 persistence/recoveryClient）**已修复**（2026-06-20，commit 40e21d3，变更 `2026-06-19-fix-interactive-daemon-lifecycle` gap-8.3）：`sillyhub-daemon/src/cli.ts:773-776` 与 `:1214` 已装配 `JsonSessionPersistence` + `recoveryClient`（client 即 HubClient，实现 RecoveryCoordinator），backend 加 recovery 端点。有 `cli-session-manager-injection.test.ts` 守护。改 daemon session 逻辑可基于此已恢复前提。

## 🟡 AgentRunLog 无 metadata 列 / 三层日志 metadata 丢失

AgentRunLog 表无 metadata 列；三层日志（daemon/backend/前端）的 metadata 在 `submit_messages` 阶段会丢失。涉及 agent-run 日志/元数据传递的改动，需注意此约束（见变更 `agent-run-pipeline-fix`）。

## 🟢 本机可能存在多个 daemon 实例

连本地（daemon-start.bat）与连远程（手动 cmd）两类 daemon 可能并存。停 daemon 时按 `--server` 区分，勿误杀；无自动拉起机制。taskkill 禁用 `/IM` 通杀（会自杀当前 claude 会话），需按 PID 精确杀。

## 🟡 Docker backend 容器不热重载（挂载非 /app、无 --reload）

`deploy/docker-compose*.yml` 的 backend 容器挂载的是宿主项目目录到 `/host-projects`（便于读文件），**不是**把源码挂进 `/app`，且启动命令无 `--reload`。容器跑的是**镜像内构建时打包的代码**。改后端源码后 `docker compose restart backend` / `up -d --build backend` 不会加载新代码——必须 rebuild 镜像（`docker compose build backend && up -d`）。
- 验证新端点/新逻辑是否生效：`curl` 实测端点响应（如 405≠401 说明新路由没进镜像），别只靠 tsc/pytest 本机通过。
- 通用坑：全 Docker 部署 + 容器不挂源码/无 reload 的项目，改后端后 curl 实测端点行为变化是唯一可靠判据。

## 🟢 frontend healthcheck busybox 误报问题已解决（commit 46591be0）

frontend 容器**已移除 healthcheck 块**（`deploy/docker-compose.yml` 的 frontend 服务无 healthcheck；commit 46591be0 改用 node fetch 自检），不再有 busybox `wget` 走 `http_proxy` 误报 unhealthy 的问题。
- 通用经验仍保留：busybox wget + 代理环境组合做健康探针会误报（busybox 不认 `no_proxy`，探测本机端口也被代理拦截）。未来若要给容器加 healthcheck，要么显式 `unset http_proxy https_proxy`，要么用 curl / node fetch 而非 busybox wget。

## 🟡 daemon pnpm overrides 把 claude-agent-sdk 8 平台二进制硬钉 0.3.181

`sillyhub-daemon/package.json` 的 `pnpm.overrides` 把 `@anthropic-ai/claude-agent-sdk` 及其 8 个平台 optionalDependency（`@anthropic-ai/...-darwin-arm64/x64`、`linux-x64/arm64`、`win32-x64/arm64` 等）版本全部钉死在 `0.3.181`。升级 SDK 前必须同步改这些 overrides，否则 pnpm 装到的实际是旧版二进制（即便 dependencies 写新版）。范围扫描：改 daemon 依赖/升级 agent SDK 时务必检查 `pnpm.overrides` 全平台条目。

## 🟢 frontend react-query 已正式启用（2026-07 OpenAPI 类型迁移，commit fecaa155 / 29b3c86b）

frontend 已在 `frontend/src/lib/providers.tsx:10` 挂载 `QueryClientProvider`，`use-daemon-runtimes.ts` / `use-agent-runs.ts` / `daemon-audit.ts` / `runtimes/page.tsx` 等多处用 `useQuery`。**新数据请求应优先用 react-query**（与 OpenAPI 生成类型 `api-types.ts` 配套）。旧 `apiFetch` + zustand 仍存在于已写页面，改动既有页面时沿用既有模式避免割裂。
- 注：`@tanstack/react-query` 在 2026-06-23 前确实仅声明未启用，本条由原"未启用"修订（见变更 `2026-07-01-react-query-migration` / `2026-07-04-frontend-openapi-types`）。

## 🟡 frontend 与 daemon 各自独立 lockfile + 双 UI 库并存

- frontend 与 daemon **各自独立 lockfile**（`frontend/pnpm-lock.yaml` + `sillyhub-daemon/pnpm-lock.yaml`），无 monorepo workspace 聚合，依赖互不可见。
- UI 库 **antd v6 与 shadcn 双 UI 库并存**（`frontend/package.json` antd `^6.4.4`），新增组件沿用所在页/模块既有 UI 库风格，别混用引入第三套。

## 🟡 audit_hooks 只在测试 lifespan 注册，生产审计要业务代码显式写 AuditLog

`backend/app/core/audit_hooks.py` 提供了 SQLAlchemy `after_flush` 事件钩子，但 `register_audit_hooks()` 仅在 `tests/conftest.py` 的测试 lifespan 调用，**生产 `backend/app/main.py` 的 lifespan 没注册**（2026-07-05 核实仍如此）。

- 后果：依赖 "audit_hooks 自动捕获" 的 service（roles/organizations CRUD）写完代码跑通单测，但部署后 `audit_logs` 表没有任何 `role.*` / `organization.*` 行；E2E 审计覆盖检查会暴露。
- 规避：业务 service 自己写 `AuditLog` 行，参考 `users_service.py` 的模式（id/workspace_id=None/actor_id/action/resource_type/resource_id/details_json/timestamp）。或在 main.py lifespan 显式调用 `register_audit_hooks(engine)`，但要先验证 hooks 对所有 ORM 模型的覆盖面。
- 排查：`docker compose ... exec -T postgres psql -U platform -d platform -tAc "SELECT action, count(*) FROM audit_logs GROUP BY action ORDER BY action"` 看是否有 `user.*` / `role.*` / `organization.*` 三类。

## 🟡 全 Docker 部署本地 PG 容器端口未映射 host，host 跑 alembic/pytest 连不上

- 现象：本项目全 Docker 部署（backend + postgres 同 compose 网络），`docker ps` 显示 postgres 容器 `5432/tcp` 但**无 `0.0.0.0:5432->5432` host 映射**；worktree backend 无 `.env`。后果：host 上 `uv run alembic upgrade` / 并发 pytest 连 `localhost:5432` 失败（拒绝连接）。
- 影响：需 host 连 PG 的验证（alembic online 往返、PostgreSQL 并发证明等）本地受限，只能用 offline SQL + metadata 对比 / SQLite fixture 等效验证，online apply 待 CI/部署补。
- 通用坑：全 Docker 部署项目，host 上跑需 DB 的命令前，先确认 PG 容器端口映射到 host；否则用 `docker exec` 进容器跑，或 SQLite fixture 等效验证 + 标注"PG 并发证明待 CI 补"。

## 🟡 ppm 导出 export-excel 路由必须前置于 item_id 路由

FastAPI 按**路由注册顺序**匹配。字面量路径 `/xxx/export-excel`（或 `/simple-list` 等）若声明在 `/xxx/{item_id}` **之后**，`export-excel` 会被 `{item_id}` 路径参数吞掉当 UUID 解析，返回 `422 uuid_parsing`（不是 404）。

- 已复现 3 次：problem（ql-020）、project（已有 test_router 守护）、plan（ql-20260714-001，里程碑明细 + 计划节点模板导出按钮双双 422）。
- 规避：新增任何 `/export-excel`、`/simple-list` 等字面量子路径端点时，**必须注册在对应 `{item_id}` GET 路由之前**，并在文件内留 `⚠ 必须前置` 注释（参照 problem/plan router）。
- 守护：加路由顺序回归测试，断言字面量路径返回 200 + 合法 xlsx（修复前为 422）。参照 `backend/app/modules/ppm/plan/tests/test_router.py`、`ppm/project/tests/test_router.py`。
- 详见 `docs/backend/modules/ppm.md` 注意事项。

## 🔴 alembic 并行变更撞 revision 多 head：启动 crash-loop

`backend/migrations/versions/` 已 144+ 个 migration（2026-08-18 实测 144，随并行 change 持续增长）。并行变更撞 revision/down_revision 即产生多 head → **应用启动 crash-loop**；SQLite 单测抓不到（PG 才暴露）。

- 规则：新 migration 必须接**真实当前 head**（先 `cd backend && uv run alembic heads` 确认，不凭记忆猜）+ 唯一 revision id；多 head 已发生时用 down_revision 收敛单 head（fix-platform-progress-pk change 踩过）。
- 关联 conventions「2026-06-15 — Alembic migration 目录与 schema 领先版本号的处理」条目（目录在 `backend/migrations/versions/` + stamp 手段），本条补并行多 head 坑。

## 🔴 前端测试闸门缺口：gen:types:check 未进 CI，E2E 零落地

- **`gen:types:check`（api-types.ts 重生成 + git diff --exit-code）未进任何 CI workflow**（`.github/workflows/` 全目录 0 命中；frontend-ci 只跑 lint/typecheck/test/build）。后端 schema 改动漏跑 regen 时前端 tsc **照样绿**（对着旧类型编译），失同步只在实际请求时暴露——当前仅靠 CLAUDE.md 规则 21 流程纪律拦截，别指望 CI 兜底；改后端 DTO 后必须自觉 `pnpm gen:types` 并同 change 提交 `api-types.ts` + `backend/openapi.json`。
- **E2E 零落地**：`@playwright/test ^1.60` + `puppeteer ^24.43` 声明在 devDependencies，但 playwright.config 与 *.spec.ts 全仓 0 命中。登录/扫描/Agent Run SSE/daemon 会话等关键流程无端到端保护，两套自动化依赖是死重——验收时别假设有 E2E 兜底，链路级问题靠手工过流程。

## 🟡 mcp Python SDK 锁死 v1 线：v2 移除 FastMCP 与平台 mount 冲突

`backend/pyproject.toml` 锁 `mcp>=1.29,<2`（L30-34 注释写明原因）：mcp SDK v2.0.0（2026-07-28）breaking 移除 FastMCP 改用 MCPServer，与 mcp_gateway 的 FastMCP ASGI mount 写法冲突，锁 v1 线取 1.29.x。v1 仅持续收 critical bugfix / security patch；未来升 v2 需重构 mcp_gateway mount 方案。

- 联动：daemon 侧 `@modelcontextprotocol/sdk ^1.29.0` 与 backend 同在 1.x 线；backend 升 2.x 时 daemon 须同步评估（升级任一方必跑 daemon `tests/mcp-server.test.ts` + `tests/mcp-config.test.ts` 验证 MCP 工具契约）。

## 🟡 Windows Docker bind mount stat 性能断崖：spec_root fs 重循环必炸

本机 Docker 部署的 workspace spec_root 是 Windows bind mount，每次 `stat`/`is_file` ≈ **1.45ms**（比原生 Linux 慢约 3 个数量级）。对 spec 树做大量 stat 的循环会性能断崖——Linux/CI 上测不出，Windows 本机 Docker 才暴露。

- 典型事故（ql-20260813-008，修复 commit ba9188cc）：change parser 加 `rglob("*")+is_file()+stat()` 算 mtime，每文件 2 次 stat；196 变更 ~3000 文件堆到 12s，reparse 总 33s 超 Next.js 代理 ~30s → 前端 ECONNRESET/500。**指纹**：backend 日志「幽灵 200」（status_code 200 + duration_ms 30000+ + slow.request warning）——后端实际跑完了，是代理放弃，别误判成后端崩。
- 规则：容器内遍历 spec/文件树一律 `os.scandir` 单遍 + DirEntry 缓存 stat（每文件 1 次 syscall；实测 12.4s→1.7s），禁止 rglob + is_file + stat 多遍组合。排查用容器内 cProfile 看 `posix.stat` 的 ncalls/tottime。

## 🟡 worktree 过期租约无自动 GC：expires_at 与索引闲置

`backend/app/modules/worktree/`：expires_at 列与 `ix_worktree_expires` 索引存在，但**没有任何后台任务/调度扫描回收**（旧 `gc_expired_leases` 已不在 service 中）。runtime-session 流程现状靠显式 release；未 release 的 worktree 目录与 askpass 脚本会滞留磁盘累积。

- 改 worktree / runtime-session 相关功能时勿假设过期自动回收；长期运行的 workspace 需人工清理残留 worktree。
- 依据：`.sillyspec/docs/SillyHub/flows/runtime-session.md`（「现状无自动 GC」）、`.sillyspec/docs/backend/modules/worktree.md`。

## 🟡 spec_guardian 死代码与 tool_gateway 注释失配：守护门从未在生产生效

- `backend/app/modules/workflow/spec_guardian.py` 的 `run_guard` 全仓仅被 `tests/test_spec_guardian.py` 引用——G3-G7 质量/文档/组件守护门**从未在生产路径生效**，变更验收别指望它把关。
- `backend/app/modules/tool_gateway/tool_policy.py:175` docstring 写「loaded by the caller (e.g., ToolGatewayService._load_policy)」但全仓无 `def _load_policy` 定义——注释与实现不一致（项目规则 18），策略装配链路现状以代码为准，勿按 docstring 理解。
- 2026-08-18 全量重扫 grep 实测；清理或接线前先确认调用方是否真的缺失。

## 🟢 daemon 三个 3000+ 行 god 文件（daemon.ts 4047 / session-manager.ts 3897 / task-runner.ts 3156）

2026-08-18 wc -l 实测：`src/daemon.ts` 4047、`src/interactive/session-manager.ts` 3897、`src/task-runner.ts` 3156。高耦合、跨文件契约靠约定、lease payload 鸭子类型几十处，**无低风险切片路径**。

- 改任一文件都需大范围定向回归（tests/ 顶层 81 + interactive/ 36 个测试文件）；涉及这三个文件的变更在 plan 阶段就应把回归面算进工作量。拆分是长期债，按触碰时机渐进处理。


## 会话日志 TOOL_RESULT 中文乱码（Windows 控制台码页，落库即坏不可导出还原）

- **现象**（2026-09-15 用户实测会话导出）：full.json 里 `[TOOL_RESULT]` 中文全乱码（如
  "EHSϵ bcm-……"），同会话 MD 摘要里 agent 正文正常——正文走 SDK message 通道，TOOL_RESULT
  文本行走子进程 stdout 捕获通道。
- **根因链**：Windows 上工具子进程（如 python 无 `PYTHONIOENCODING`）按控制台码页 GBK 编码
  输出 → 捕获方按 UTF-8 解码（lossy，产生 U+FFFD 替换字符）→ `agent_run_logs.content_redacted`
  落库即坏。替换字符有损，**导出层无法还原**（导出只原样搬运列值）。
- **规避**：agent 侧跑 Bash/python 工具时显式 `PYTHONIOENCODING=utf-8`（用户实证 agent 设过
  后拿到正确文本）；或 chcp 65001。
- **根治进展**（ql-20260915-005-3268）：daemon 非 SDK 链（pi/cursor/codex/task-runner 捕获层）
  已加码页探测解码（spawn-env.ts `decodeProcessOutputMaybe` 立即版 + `CodepageDetectorDecoder`
  有状态流式版，覆盖全部捕获点）；**Claude SDK 链（claude CLI stdout 由上游
  @anthropic-ai/claude-agent-sdk setEncoding('utf8')）字节在 SDK 边界已固化，daemon 侧探测
  救不回**——治本已落地：buildSpawnEnv 出口缺省注入 `PYTHONIOENCODING=utf-8`+
  `PYTHONUTF8=1`（仅键缺失/空串填入，显式配置优先），claude→Bash→工具孙进程全链
  继承，新会话起生效（存量乱码行仍不可还原）。
- **勘误**（ql-20260916-003）：上段「有状态流式版」原实现（StringDecoder 失败切 GBK）
  是死代码——Node `StringDecoder.write()` 从不抛错，流式捕获链的 GBK 输出实际仍乱码；
  已重写为增量 UTF-8 严格校验 + 非法字节切 GBK 流式（未决尾字节一并重解），非 SDK
  链根治至此真正闭合。
- **登记于**：ql-20260915-004（2026-09-14-session-export 用户验收反馈 P2-2）。

## 🟡 后台任务写通道宽限无界（hasBackgroundTaskGrace 无 TTL，R-01 已接受观察项）

- **暴露差**（2026-09-16 风险审查发现）：同类第一放行源 `withinStaleFlipGrace` 有界 60min
  （`STALE_RUN_WRITE_GRACE_MS = 60 * 60_000`，sillyhub-daemon/src/interactive/session-manager/types.ts:452，
  permission.ts `withinStaleFlipGrace` 消费），而 bg-task 第三放行源 `hasBackgroundTaskGrace`
  （permission.ts）无时间上限——注册表条目（`mgr._backgroundTasks`）仅 task_notification 终态
  注销与会话终态 `clearBackgroundTasks` 两路注销，条目有 `startedAt`/`lastProgressAt` 但无 TTL；
  若 SDK 丢失终态通知，条目永驻 → 后台锚点 `currentRunId` 永不清 → 写通道放行直至会话终态。
- **缓解链**（维持有效）：仅放行「通道存在性」（allowed_roots/policyEngine 写策略 + 人审链路
  全程生效）；下次 inject 正常切新 run 即收敛；会话终态兜底清锚点；daemon 重启内存注册表丢失
  自然 fail-closed。前作 R-01
  （2026-09-15-background-task-permission-lockout/design.md 风险登记表）已按此接受为 P1。
- **重估触发条件**：线上再现注册表泄漏实证（守卫放行但无对应存活后台任务），或
  policy_audit_log 出现锚点态误放行线索。
- **未来修复首选**：双窗兜底——条目存活 = 静默 <60min（对齐 stale-flip 先例，`lastProgressAt`
  已有信号）且总时长 <4h 绝对上限；原事故任务存活 94.5min（1030 次重试/~$46），双窗防误杀，
  静默阈值小于先例会重演权限锁死。
- **登记于**：2026-09-16-background-task-grace-timeout（D-001@v1 用户裁决「不改代码」，
  文档载体方案 A）。

## 🟢 2026-06-05 — sync_stage_status 找不到 change_key 的 dual-db 问题（已修复）

- SpecWorkspace（platform-managed）和 workspace root_path 各有独立的 `.sillyspec/.runtime/sillyspec.db`。
- `_resolve_db_path` 优先用 SpecWorkspace.spec_root，但 Agent worktree 里的 SillySpec CLI 写入的是 workspace root_path 下的 sillyspec.db。
- `sync_stage_status` 在 spec_root 的 db 里找不到 change_key → `synced=False` → `auto_dispatch_next_step` 不触发 → `complete_stage` 不执行 → `human_gate` 永远是 `none`。
- 修复：`_resolve_db_path` 增加 fallback，change_key 不在首选 db 时自动切换到 root_path db。

## 🟢 2026-06-05 — auto_dispatch_next_step 只在 has_pending_step 时触发（已修复）

- `agent/service.py` 原逻辑：`if sync_result.synced and sync_result.has_pending_step` 才调用 `auto_dispatch_next_step`。
- brainstorm 完成时所有 steps completed → `has_pending_step=False` → 不调用 → `complete_stage` 永远不执行。
- 修复：条件改为 `sync_result.synced and (sync_result.has_pending_step or sync_result.stage_completed)`。

## 🟢 2026-06-05 — complete_stage 不调用 reparse 导致文档不全（已修复）

- Agent 生成文件后写入磁盘，但 `complete_stage` 只更新 DB 状态（current_stage, human_gate），不同步 `change_documents` 表。
- 前端看到的文档列表来自 DB，磁盘上的新文件（design.md, requirements.md, tasks.md）不会出现。
- 修复：`auto_dispatch_next_step` 在调用 `complete_stage` 前先 `reparse` 同步文档。

## 🟢 2026-06-17 — login_enabled 必须在 get_current_user 检查，不能只在 login 入口（commit d62ec975）

- 仅在 `auth/service.py:login()` 检查 `user.login_enabled` 是不够的：用户已持有有效 JWT，管理员调用 `disable-login` 后，旧 token 在自然过期前仍能访问所有 `/api/*` 端点。
- 必须在 `backend/app/core/auth_deps.py:get_current_user()` 内补一道 `if not getattr(user, "login_enabled", True): raise AuthUserLoginDisabled(...)`，配合 `users_service._revoke_sessions()` 在 disable-login 时把 sessions 全部标记 revoked_at，才能让 token 立即失效。
- **已修复**（2026-07-05 核实，commit `d62ec975`）：`backend/app/core/auth_deps.py:78-79` 已有 `if not getattr(user, "login_enabled", True): raise AuthUserLoginDisabled(...)`。本条保留作安全模式回溯。
- E2E 验证：disable-login 后立刻拿旧 token GET `/api/auth/me`，期望 401；用密码重新登录，期望 401 + `HTTP_401_AUTH_USER_LOGIN_DISABLED`。

## 🟢 2026-06-19 — alembic.ini 注释含 UTF-8 em-dash 导致 Windows gbk configparser 崩溃（已修复）

- 现象：Windows 中文 locale 下 `uv run alembic <cmd>` 报 `UnicodeDecodeError: 'gbk' codec can't decode byte 0x94`。根因：`backend/alembic.ini` 注释含 UTF-8 em-dash（`—` = e2 80 94），alembic `compat.read_config_parser` 用 locale 默认编码（Windows zh = gbk/cp936）读 ini 解码失败。
- `PYTHONUTF8=1` / `python -X utf8 -m alembic` **均无效**（alembic compat 层不走 utf8 mode；直接 `configparser.read()` + `-X utf8` 能读，但 alembic CLI 入口路径不行）。
- **已修复**（2026-07-05 核实）：`backend/alembic.ini` em-dash 计数为 0，注释已改 ASCII。
- 通用坑：Windows 本地跑 alembic 的项目，alembic.ini / 其他 .ini 注释避免 UTF-8 特殊标点（em-dash/智能引号），用 ASCII。

## 🟢 2026-06-20 — cursor-agent 官方 ps1 版本目录正则不匹配新版目录命名，导致 cursor 完全不可用（已修复）

- 现象：daemon 注册的 cursor runtime 版本显示「待识别」（实际注册 'unknown'），cursor task 启动即崩（exit 1）。其他 provider 正常。daemon 心跳/在线正常（因为 resolveBinPath 找到 cursor-agent.cmd 就算 available，与版本探测是否成功无关）。
- 根因：cursor-agent 官方安装在 `%LOCALAPPDATA%\cursor-agent\`，`cursor-agent.cmd` → `cursor-agent.ps1`。ps1 用正则 `^\d{4}\.\d{1,2}\.\d{1,2}-[a-f0-9]+$` 找 `versions/` 下最新版本目录，但新版 cursor 的目录名是 `YYYY.MM.DD-HH-MM-SS-commit`（含时分秒、多段 `-`），`-` 后非纯十六进制 → 不匹配 → ps1 `Write-Error "No version directories found"` + `exit 1`。
- 修复（ql-20260620-002-f8c1）：daemon 侧绕过 ps1 —— 新增 `resolveCursorVersionEntry` 扫描 versions 目录取最新；`agent-detector` cursor 版本探测 fallback 取目录名作版本；`cmd-shim` 模式0 把 `cursor-agent.ps1` 解析为 version 目录的 `node.exe index.js` 入口让 task-runner 直跑。
- 通用坑：第三方 CLI 的启动包装脚本（.ps1/.cmd）若用正则找自更新版本目录，正则可能跟不上自身新版目录命名格式变化。遇到「CLI `--version` / 启动报奇怪错误且 exit 1、但二进制确实存在」时，先检查其包装脚本的版本查找逻辑是否过时，必要时绕过包装层直接调 version 目录的真实入口。

## 🟢 2026-06-21 — ETL 迁移函数执行顺序依赖 maps 构建时机，ppm 模块整表成孤儿（已修复）

- `backend/scripts/migrate_from_ruoyi.py` 的 `migrate_plan_node_module.plan_node_id` 实际指向 `ps_plan_node`（里程碑，非 plan_node 模板），但原 main() 把它排在 `migrate_ps_plan_node`（构建 `maps["ps_plan_node"]`）之前 → `map_fk` 全失败 → `fallback_keep=True` 保留源数字 ID → 被 ALTER varchar→uuid 迁移丢弃为 NULL → 模块成孤儿。
- 排查线索：对照组 `migrate_ps_plan_node_detail`（排在 ps_plan_node 之后）正常映射，唯独 module 全军覆没；"子表全空"时优先查 FK 列 NULL 比例即可定位，别只盯前端。
- 修复（ql-20260621-004-f2a1）：main() 顺序调整，module 移到 ps_plan_node 之后；已落地的孤儿用 `backend/scripts/resync_modules.py`（幂等 DELETE+INSERT，id 用确定性 uuid5）重同步。
- 通用坑：ETL 脚本里各 `migrate_*` 函数依赖前序函数构建的 maps dict，新增/调整迁移函数时务必确认其 `map_fk` 依赖的 map_key 已由排在前面的函数构建。

## 🟡 2026-06-26 — daemon allowed_roots 只管 list_dir RPC，不管 CC 执行 cwd

> 来源：2026-06-26-daemon-root-path-translation execute（design D-002 superseded）。

- daemon `assertWithinAllowedRoots`（`sillyhub-daemon/src/file-rpc.ts`）只被 `listDir` 调用（list_dir RPC），**不用于 CC 执行的 cwd/文件访问**。CC 的 cwd 由 `task-runner.ts` `prepareWorkspace` 分支0 `statSync(rootPath)` 决定，CC 访问文件走 OS 权限（独立进程）。
- 设计 daemon 侧"放行 CC 访问"类功能时，勿误以为 allowed_roots 管 CC 执行——它只管 daemon 自身的 list_dir RPC（前端浏览目录场景）。CC 能否在项目根执行 + 访问源码，取决于 backend 下发的 root_path 是否为 daemon 可 statSync 的宿主机路径。

## 🟡 2026-06-30 — install.sh 改动需重建 backend 镜像才下发（baked into image）+ bash heredoc ${VAR} 转义陷阱

- **生效路径**：`sillyhub-daemon/scripts/install.sh` 不是运行时读取，而是 backend 镜像构建时 `COPY scripts/install.sh /app/daemon-dist/install.sh`（backend/Dockerfile:86）baked 进镜像，由公开端点 `/daemon/install.sh` 下发（`app/modules/daemon/dist_router.py`，无 /api 前缀）。改 install.sh 后必须**重建并重新部署 backend 镜像**，新安装的用户才拿到新版；仅改文件不重建，下发的仍是旧镜像里的 install.sh。`config.py` 的 `daemon_dist_dir` 仅在测试用 tmp_path 覆盖，生产是镜像内固定路径。
- **heredoc 转义陷阱**：bash 无引号 heredoc（`<<EOF`）中，`\${VAR}` 的反斜杠会转义 `$` → 输出字面 `${VAR}` 不展开；要展开须让 `$` 前无反斜杠，或用 `\\` 分隔。install.sh 生成 `.cmd` wrapper 时写 `"${win_bin_dir}\${BUNDLE_NAME}"`，Windows 路径反斜杠紧贴 `${` 触发此陷阱，生成的 .cmd 含字面量 `${BUNDLE_NAME}`。修复：bundle 路径改用 cmd 内置 `%~dp0`（=该 .cmd 自身所在目录，自相对、bash heredoc 不碰 `%`、不依赖运行时 PATH）。
- **本机已装实例**：install.sh 重建下发只影响**新安装**；本机已生成的 `~/.sillyhub/daemon/bin/sillyhub-daemon.cmd` 需手工修或重装才修复。

## 🟡 2026-07-01 — Next.js rewrite proxy 对长请求 socket hang up + daemon 分发以 git SHA 为版本号

- **Next.js rewrite proxy 超时**：frontend `next.config.mjs` 用 `rewrites` 把 `/api/:path*` 代理到 backend（Next.js 14.2.5 standalone node server，非 nginx）。backend 处理慢（>~20-30s）时 proxy 端 `socket hang up / ECONNRESET` 返 500 给浏览器，但 backend 仍在后台跑完（业务成功、前端误报）。根治：耗时端点改 SSE 流式（text/event-stream 长连接 + 阶段事件 + 长阻塞段每 5s yield `: keepalive` 注释行保活），前端原生 fetch+ReadableStream 解析（不复用 JSON 的 apiFetch）。参考范式：`agent/router.py:_SSE_HEADERS` + `StreamingResponse(gen, media_type="text/event-stream")`。
- **daemon 分发以 git SHA 为版本号**：`pnpm bundle` 的 `BUILD_ID={commit-sha}-{timestamp}`（build-bundle.sh 写 src/build-id.ts），backend `/daemon/latest.json` 分发此 version，daemon `preflight` 启动时比较本地 vs 服务器 SHA 决定是否自更新。**未 commit 的 daemon 改动 bundle 后 BUILD_ID 仍是当前 HEAD SHA**——若用户 daemon 已是该 SHA，preflight 判定版本相同不更新，新代码不生效。故 daemon 改动必须**先 commit（新 SHA）→ 再 bundle → 再 rebuild backend**，分发版本才会递增。
- **apply_sync 黑盒 vs SSE 分阶段**：原 `apply_sync`（写盘+reparse 整体返回 int）无法在 SSE 中途 yield reparse 阶段进度。解法：提取 `_write_spec_root`（写盘+commit clean）供 apply_sync 与 SSE 生成器共用，SSE 顺序调 `_write_spec_root`→`_reparse_phase(scan_docs)`→`_reparse_phase(change)`，每步 yield 事件。两阶段 reparse 各自 try/except 设 dirty 不阻断（D-003，docs/changes 独立数据，部分成功优于全失败）。

## 🟢 2026-07-13 — backend rebuild apt 连不上 deb.debian.org（base image digest 漂移致 apt 缓存失效裸奔，已修复）

> 来源：ql-20260713-001-9f3e（install.sh 修复 ql-20260710-003 上线时触发）。与同文件「2026-06-30 — install.sh 改动需重建 backend 镜像才下发」条目同属 daemon 分发链路。

- 现象：`docker compose up --build` 重建 backend 在 `[runtime 3/14] RUN apt-get update` 报 `Could not connect to deb.debian.org`（Connection refused）→ `Unable to locate package curl/git` → 整个 build 失败。运行中的旧容器不受影响（仍 healthy）。
- 根因：runtime stage 的 apt 层平时缓存命中不需联网；当 base image `python:3.12-slim` 上游 digest 漂移（docker hub 重新推送同 tag），FROM 层变化使后续所有层缓存失效，apt-get update 需重新联网，而 deb.debian.org 在国内网络不可达——pip（tsinghua）/npm（npmmirror）都已配国内源，唯独 apt 漏配。
- 修复（ql-20260713-001-9f3e）：backend/Dockerfile L66-76 在 apt-get update 前加 `find /etc/apt \( -name sources.list -o -name '*.sources' \) -exec sed -i 's|deb.debian.org|mirrors.tuna.tsinghua.edu.cn|g' {} +`。trixie 用 DEB822 `/etc/apt/sources.list.d/debian.sources`，旧版用 `sources.list`，find 双覆盖；找不到文件时 `-exec` 不执行、退出码仍 0，无副作用。
- 通用坑：Dockerfile 多阶段里 pip/npm 配了国内镜像但 apt 漏配是常见隐患——平时缓存命中掩盖了 apt 源不可达，一旦 base image digest 漂移或 `--no-cache` 就裸奔 build 失败。新项目 Dockerfile apt 层统一配国内源，与 pip/npm 对齐。

## 🟢 2026-07-13 — install.sh WSL 下 1c/1d 盘符转换 bug（/e/ vs /mnt/e/）+ CMD bash 默认解析到 WSL（已修复）

> 来源：ql-20260713-003-b3d7。与同文件「2026-06-30 — install.sh 改动需重建 backend 镜像才下发」条目同属 daemon install.sh 链路。

- 现象：用户 node 在 `E:\Software\nvm`（nvm-windows，NVM_SYMLINK=E:\Software\nodejs → 版本目录），从 CMD 跑 `curl .../daemon/install.sh | bash` 报"未检测到 node，安装中止"。但 install.sh 1d PowerShell 注册表逻辑本身在本机直接跑能找到 `E:\Software\nodejs\node.exe`（注册表 PATH 有）。
- 根因①（CMD `bash` 解析）：用户系统装了 WSL（Ubuntu），CMD 敲 `bash` 默认解析到 `C:\Windows\System32\bash.exe`（WSL），**不是** Git Bash——除非 Git Bash 的 `bash.exe` 在 PATH 更前。install.sh 在 WSL 跑（IS_WSL=1）。
- 根因②（盘符转换 bug）：1c（cmd where）+ 1d（powershell 注册表）都成功拿到 Windows 路径 `E:\Software\nodejs\node.exe`，但盘符转换硬编码 `/${drive}${path:2}`（Git Bash 风格 `/e/`），WSL 下 `/e/` 不存在（应 `/mnt/e/`）→ `[[ -f /e/... ]]` 失败 → NODE_BIN 空。1a（WSL PATH 不含 Windows node）+ 1b（候选路径无 /mnt/e/）也失败，1c/1d 是唯一救命稻草却被盘符转换坑了。
- 修复（ql-20260713-003-b3d7）：install.sh 抽 `win_to_unix_path` 函数，按 IS_WSL 决定前缀（WSL → `/mnt/<drive>/`，Git Bash → `/<drive>/`），1c/1d 改调它。验证：WSL 内层跑改后脚本 check_node = 找到 node（注册表 PATH）: `/mnt/e/Software/nodejs/node.exe` v24.14.1。
- 通用坑：跨 Git Bash/WSL 的 shell 脚本，Windows 路径转 unix 路径必须区分两种映射（MSYS `/c/` vs WSL `/mnt/c/`），不能硬编码其中一种。WSL 默认 automount 所有 Windows 盘到 `/mnt/<drive>/`；Git Bash (MSYS) 挂到 `/<drive>/`。检测 IS_WSL（`/proc/sys/kernel/osrelease` 含 `microsoft`）后选对应前缀。写 Windows 安装脚本时**别假设 `bash` = Git Bash**——Win10/11 装了 WSL 后，CMD/PowerShell 里 `bash` 默认是 WSL 的 bash.exe。

## 🟢 2026-07-13 — install.sh WSL 下 $USER ≠ Windows 用户名（拼 /mnt/c/Users/<name> 目录坑，已修复）

> 来源：ql-20260713-004-7e2a。继同文件「2026-07-13 — install.sh WSL 下 1c/1d 盘符转换 bug（/e/ vs /mnt/e/）+ CMD bash 默认解析到 WSL」条目之后又一个 WSL 兼容坑。

- 现象：install.sh 在 WSL 下 `mkdir -p "$INSTALL_DIR"` 报 `Permission denied`（node 检测 + fetch_latest 都过了，卡在 download_bundle 的 mkdir）。
- 根因：WSL 的 `$USER` 是 **Linux 用户名**（默认常 root），≠ Windows 用户名。install.sh WSL 分支原用 `$USER` 拼 `/mnt/c/Users/${USER}/.sillyhub/daemon`，若 WSL $USER=root 则 `/mnt/c/Users/root/` 不存在（Windows 用户目录是 `<winname>`，如 12532），`mkdir -p` 在 `C:\Users\` 下建 `root/` 被 drvfs 拒。
- 修复（ql-20260713-004）：WSL 下改用 `/mnt/c/Windows/System32/cmd.exe /c "echo %USERPROFILE%"` 拿真实 Windows 用户目录（`C:\Users\<winname>`），转 `/mnt/<drive>/...` 拼 INSTALL_DIR。**`powershell $env:USERPROFILE` 在 WSL root 下不展开**（`$env` 被 bash/interop 吃，返回空），`cmd.exe echo %USERPROFILE%` 可靠。
- 通用坑：WSL 下要拿 Windows 用户目录/用户名，**别用 WSL 的 `$USER`/`$HOME`**（是 Linux 的，常 root），用 `cmd.exe /c "echo %USERPROFILE%"`/`%USERNAME%` 或读注册表。跨 Git Bash/WSL 的脚本里 `$USER` 语义不同：Git Bash `$USER`=Windows 用户名，WSL `$USER`=Linux 用户名——不能假设一致。

## 🟢 2026-07-29 — SILLYSPEC_MASTER_KEY 非 hex 值致 get_cipher() 裸 ValueError 全模块 500（部署已修复）

> 来源：ql-20260729-001-b3af（GET /api/llm-providers 500 修复）。

- 现象：GET /api/llm-providers 返回 500（及所有走 `CredentialCipher` 的接口：llm_provider / git_identity / worktree 等）。后端日志 `ValueError: non-hexadecimal number found in fromhex() arg at position 0`，栈顶在 `app/modules/llm_provider/service.py:138 _default_cipher` → `app/core/crypto.py:49 bytes.fromhex`。
- 根因：`deploy/.env` 的 `SILLYSPEC_MASTER_KEY` 被填成人类可读标识串 `msk-sillyhub-dev-90d223fd-...`（看着像密钥，实则非十六进制）。`crypto._load_master_key()` 只对**空值**抛友好 `MasterKeyMissing`，非空但非 hex 直接走 `bytes.fromhex(hex_key)` → 裸 `ValueError` → `get_cipher()` 构造期崩溃 → 任何 `new LlmProviderService(session)` / `WorktreeService(...)` 立即 500（list 接口构造 service 时就炸，根本到不了 SQL）。
- 修复（ql-20260729-001-b3af）：`deploy/.env` 第5行换成合法 `v1:<secrets.token_hex(32) 生成的 64位hex>`；`docker compose up -d --force-recreate backend` 重建容器重读 env。零数据风险：`llm_providers`/`git_identities` 表均空、`api_keys` 为 hash 存储不依赖 master key。
- 通用坑：① `SILLYSPEC_MASTER_KEY` 格式必须是 `<key_id>:<64位hex>`（如 `v1:ab12...`）或裸 64 位 hex，**不能**填标识串/base64/明文密码；生成命令 `python -c "import secrets; print(f'v1:{secrets.token_hex(32)}')"`（`crypto.py:42` MasterKeyMissing 的 hint 已给）。② `deploy/.env` 被 `.gitignore`，改它不进 `git status`，靠重建容器重读 env 落地（`docker compose up -d` 检测到 backend env 变化会自动 recreate，保险用 `--force-recreate backend`）。③ `_load_master_key` 对「非空但格式非法」抛裸 ValueError 是健壮性缺陷——建议后续把 `bytes.fromhex` 包 try/except 转 `MasterKeyMissing`（带 hint），避免 500 时栈里只有裸 fromhex 难定位。**（2026-09-28 核实：`crypto.py:49` 的 `bytes.fromhex` 仍无 try/except 包裹，该健壮性建议至今未做。）**

## 🟡 AgentMission.session_id 列非 NULL 不可信：判别口径须查表确认指向真实 AgentSession

session_id 列 NOT NULL + default_factory=uuid4（为兼容 ~50 处存量构造不传该字段的测试/路径）意味着"列非 NULL"不等于"绑定会话"——存量/旧链路 mission 会带随机 uuid。判别会话 mission 的正确口径=查表确认 session_id 指向真实存在的 AgentSession（patrol/finalizer 的 _mission_bound_session 同源实现）。来源：2026-08-22-team-session-unify task-01/06（Grill NEW-4 延伸）。

## 🟡 2026-08-24 — 后台子代理脱离平台 running turn 后权限回调 fail-closed 死锁（已有宽限缓解）

> 来源：2026-08-24-platform-session-feedback-fix Wave 1 执行期（task-01 / task-08 后台子代理）。

- 现象：子代理（`run_in_background: true`）在父 turn 派发后若干分钟完成读码/设计，开始写操作（Edit/Write/Bash 非只读/MCP sillyhub）时，全部被拒绝：`session not in running turn`。只读操作（Read/Grep/Glob/git status/ls/cat）正常。协调者（本 agent）通过监控循环「保活 turn」无法改变子代理绑定的平台 SessionState——子代理的 canUseTool 回调与父 turn 的 currentRunId 解耦，只有真实用户新消息开新 turn 才恢复写权限。
- 根因：`sillyhub-daemon/src/interactive/session-manager.ts:811` 与 `:1585` 的 canUseTool 回调在 `state.status !== 'running' || !state.currentRunId` 时直接 deny；后台子代理存活到 turn 结束后，currentRunId 失效，所有写操作 fail-closed。当前平台无「子代理权限请求路由到父会话/排队重试」机制。
- 规避：execute 阶段派耗时子代理时，改用 `run_in_background: false` 同步子代理，确保子代理在父 turn 的真实 run 窗口内完成全部写操作；若必须后台并行，则把「只读调研」放后台，写操作集中在主 turn 内由同步子代理机械应用。该现象本身也印证了本变更 FR-03（后台 Agent 任务进度可见）的痛点：会话不应在后台子代理仍在工作时提前失去 running 态。
- 修复建议（平台侧）：canUseTool 对子代理或派生会话引入 grace period / 父会话委托 / 队列重试，避免正常后台工作被 turn 边界切断。
- **现状更新（2026-09-28 核实）**：后续变更 2026-09-15-background-task-permission-lockout 已为后台任务引入写通道宽限（`sillyhub-daemon/src/interactive/session-manager/permission.ts` 的 `hasBackgroundTaskGrace` 第三放行源），正常后台任务的写锁死面已收窄；宽限自身的无 TTL 风险见本文件「后台任务写通道宽限无界」条目。

## 🟢 daemon sessions /events 字面量路由被 /sessions/{session_id} 参数路由吞掉（FastAPI 路由顺序，commit 0c7860f7）

> 来源：2026-08-24-sessions-live-updates verify 真实运行时冒烟（commit 0c7860f7 修复）。同族通病见本文件「ppm 导出 export-excel 路由必须前置 item_id」条目。

- 现象：`GET /api/daemon/sessions/events` 带鉴权请求返回 422 uuid_parsing——"events" 被两段式参数路由 `GET /sessions/{session_id}`（get_session_detail）当作 {session_id} 吞掉，端点在真实路由下不可达；task-04 注释只要求先于三段式 `/sessions/{id}/...`，漏了两段式详情路由。
- 盲区三连：① 审查 grep 用单行模式 `@router.get("` 漏掉多行装饰器（路径在下一行）；② 端点测试直接调路由函数（`await stream_sessions_events(user=...)`）绕过路由表，路由顺序永不进入测试；③ 唯一路由级测试只断言未登录 401——FastAPI auth 依赖先于路径参数校验触发，遮蔽路由下同样 401，红不了。
- 规避：新增字面量路径且同前缀存在参数路由时——审查用多行感知 grep（`grep -A1 '@router\.get($'`）；测试补路由表级断言（按注册序找首个方法+regex 匹配，断言 endpoint 是预期函数，不消费 body）；SSE/无限流端点测试勿走 httpx client 消费 body（ASGITransport 收全量 body 才返回，`client.stream()` 也挂死），路由可达性用路由表断言替代。真实运行时冒烟（真 uvicorn + curl）是最后防线——本缺陷单测 5186 全绿仍存在。

## 🟡 2026-08-26 — antd v6 实测三坑：Image 无 wrapperClassName、Modal 语义 styles.container、枚举式 vi.mock 须随桶导出同步

> 来源：2026-08-26-file-fullscreen-preview execute（task-03/04 实现期实测 + QA 验收抓回归）。

- Image：v6 已删 `wrapperClassName`，撑高外层 wrapper 用语义槽 `classNames={{ root: "..." }}`（grep @rc-component/image 确认 root 落 wrapper div）；img 的百分比 max-h 需 wrapper 有高度基准，否则解析不了。
- Modal：v6 语义键是 `styles.container`（v5 的 `styles.content` 不再命中内容容器）；`style+width` 挂 `.ant-modal` 根，默认 `top:100/max-width:calc(100vw-32px)`，做全屏需同时覆盖 `width=100vw + style={{top:0, maxWidth:"100vw"}}`。
- 测试：枚举式 `vi.mock("桶文件", () => ({...}))` 工厂在桶文件新增导出时会让模块作用域引用（如 RENDERER_MAP）直接炸套件（"No X export is defined on the mock"）——桶加导出必须同步补 mock 工厂，且这类断裂是套件级（0 test 收集），vitest 汇总里表现为 1 test file failed 而非用例 failed。

## wt-commit 的 -- 路径分隔符被 PowerShell 5.1 吞掉——用 --pathspec-from-file

Windows PowerShell 5.1 向原生命令传参时裸 `--` 会被剥掉，`sillyspec wt-commit --change X -m "..." -- path1 path2` 报「缺少提交路径」且加引号无效。规避：路径写入临时文件后 `sillyspec wt-commit --change X -m "..." --pathspec-from-file <file>`（每行一个路径，UTF-8）。Git Bash / PowerShell 7 无此问题。（来源：2026-09-23-md-card-render task-01）
