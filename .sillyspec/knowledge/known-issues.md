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
