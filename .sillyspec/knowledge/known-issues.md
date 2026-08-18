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

daemon 重启后 interactive session 丢失致 turn 卡死的根因（`cli.ts` 漏传 persistence/recoveryClient）**已修复**（2026-06-20，commit 40e21d3，变更 `2026-06-19-fix-interactive-daemon-lifecycle` gap-8.3）：`cli.ts:412-449` 已装配 `JsonSessionPersistence` + `recoveryClient`（client 即 HubClient，实现 RecoveryCoordinator），backend 加 recovery 端点。有 `cli-session-manager-injection.test.ts` 守护。改 daemon session 逻辑可基于此已恢复前提。

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

frontend 已在 `src/lib/providers.tsx:10` 挂载 `QueryClientProvider`，`use-daemon-runtimes.ts` / `use-agent-runs.ts` / `daemon-audit.ts` / `runtimes/page.tsx` 等多处用 `useQuery`。**新数据请求应优先用 react-query**（与 OpenAPI 生成类型 `api-types.ts` 配套）。旧 `apiFetch` + zustand 仍存在于已写页面，改动既有页面时沿用既有模式避免割裂。
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
- 关联 uncategorized「Alembic migration 目录与 schema 领先版本号的处理」条目（目录在 `backend/migrations/versions/` + stamp 手段），本条补并行多 head 坑。

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
