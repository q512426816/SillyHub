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

## 🟡 frontend healthcheck busybox wget 走 http_proxy 误报 unhealthy

frontend 容器 healthcheck 用 busybox `wget`，而容器内环境注入了 `http_proxy`/`https_proxy`（Docker compose env），busybox wget **不认 `no_proxy`**，探测本机端口也被代理拦截 → 探针永远失败 → `docker ps` 显示 frontend `unhealthy`。
- 这是**探针误报**，服务实际正常（curl 直接打容器内端口 200）。
- 通用坑：busybox wget + 代理环境组合做健康探针会误报；要么 healthcheck 显式 `unset http_proxy https_proxy`，要么换 curl/wget(非busybox)，或确认服务真健康后忽略探针状态。

## 🟡 daemon pnpm overrides 把 claude-agent-sdk 8 平台二进制硬钉 0.3.181

`sillyhub-daemon/package.json` 的 `pnpm.overrides` 把 `@anthropic-ai/claude-agent-sdk` 及其 8 个平台 optionalDependency（`@anthropic-ai/...-darwin-arm64/x64`、`linux-x64/arm64`、`win32-x64/arm64` 等）版本全部钉死在 `0.3.181`。升级 SDK 前必须同步改这些 overrides，否则 pnpm 装到的实际是旧版二进制（即便 dependencies 写新版）。范围扫描：改 daemon 依赖/升级 agent SDK 时务必检查 `pnpm.overrides` 全平台条目。

## 🟡 frontend 声明了 @tanstack/react-query 但源码未启用，实际数据层是 apiFetch + zustand

`frontend/package.json` 声明了 `@tanstack/react-query` 依赖，但**源码全局未启用**（无 `QueryClientProvider`、无 `useQuery`）。实际数据层是自封装的 `apiFetch`（`fetch('/api/...')` + 401 自动 refresh token）+ zustand 状态管理。
- 写新数据请求时**别用** react-query，沿用 `apiFetch` + zustand 模式，否则与现有数据层割裂。
- frontend 与 daemon **各自独立 lockfile**（`frontend/package-lock`? 实为 `frontend/pnpm-lock.yaml` + `sillyhub-daemon/pnpm-lock.yaml`），无 monorepo workspace 聚合，依赖互不可见。
- UI 库 **antd v6 与 shadcn 双 UI 库并存**，新增组件沿用所在页/模块既有 UI 库风格，别混用引入第三套。
