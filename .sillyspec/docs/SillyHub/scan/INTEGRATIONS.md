---
source_commit: fcbf3fa7
updated_at: 2026-06-22T18:12:59Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 02:12:59
---

# SillyHub — 外部集成（产品根）

> 本文档由 `sillyspec-scan` 在 `fcbf3fa7` 处扫描 SillyHub 产品根生成。
> 按「类型」分组列出 SillyHub 依赖的外部系统、SDK 与运行时，并标注它在哪个子项目被使用。
> 信息来源：`deploy/docker-compose.yml`、`deploy/docker-compose.dev.yml`、`backend/pyproject.toml`、
> `frontend/package.json`、`sillyhub-daemon/package.json`，以及对源码的 `grep` 结果。

## 1. 数据库：PostgreSQL

- **角色**：主数据持久化（用户、会话、Agent 运行记录、SillySpec 元数据、PPM 项目域等，约 55 张表）。
- **版本**：`postgres:16-alpine`（`deploy/docker-compose.yml`）。
- **服务名 / 端口**：`postgres` 服务，容器内 `5432`，宿主机默认 `${POSTGRES_PORT:-5432}`。
- **连接串**（注入到 backend 容器）：`postgresql+asyncpg://${POSTGRES_USER:-platform}:${POSTGRES_PASSWORD:-platform}@postgres:5432/${POSTGRES_DB:-platform}`。
- **客户端依赖**（backend）：`sqlmodel>=0.0.22`、`sqlalchemy[asyncio]>=2.0`、`asyncpg>=0.29`、`alembic>=1.13`。
- **健康检查**：`pg_isready -U <user> -d <db>`；数据卷 `pgdata`（命名卷）。

## 2. 缓存 / 消息：Redis

- **角色**：缓存与进程间消息传递；后端用于 Pub/Sub、SSE 事件桥接、分布式锁。
- **版本**：`redis:7-alpine`（`deploy/docker-compose.yml` / `dev.yml`，appendonly AOF 持久化）。
- **服务名 / 端口**：`redis` 服务，dev 编排暴露宿主 `${REDIS_PORT:-6379}`，连接串注入为 `redis://redis:6379/0`。
- **客户端依赖**（backend）：`redis>=5.0`。
- **代码引用**：`backend/app/core/redis.py`（客户端封装），以及 `backend/app/modules/daemon/session/service.py`、`agent/service.py`、`spec_workspace/bootstrap.py`、`health/router.py` 等多处使用 redis / pub-sub / `EventSourceResponse`（grep 命中约 26 文件）。

## 3. LLM API：Claude（Anthropic）

- **角色**：实际的大模型推理与 Agent 执行后端。
- **接入方式**：
  - **直接调用**：backend 不直接 import Anthropic / OpenAI SDK；仅通过环境变量 `ANTHROPIC_*` 传递配置（`backend/app/modules/agent/delegation.py` 中 `Build from ANTHROPIC_* env`）。
  - **间接调用（主路径）**：由 `sillyhub-daemon` 通过 `@anthropic-ai/claude-agent-sdk`（见下节）驱动 Claude 进程，backend 通过 daemon 协议与之交互。
- **凭证流**：`sillyhub-daemon/src/credential.ts` / `spawn-env.ts` 负责把宿主机凭证注入子进程环境；Docker 部署下由 `deploy/.env` 注入 backend 容器，避免宿主环境变量覆盖。

## 4. 本地进程编排：Claude Agent SDK

- **承载子项目**：`sillyhub-daemon`（Node ≥20 ESM 单进程）。
- **核心依赖**：`@anthropic-ai/claude-agent-sdk@0.3.181`（`sillyhub-daemon/package.json`，并对 win32/linux/darwin 多平台二进制做了 pnpm overrides 统一指向主包）。
- **使用点**（grep 命中）：
  - `src/interactive/claude-sdk-driver.ts`：`import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk'`（驱动交互式会话）。
  - `src/interactive/session-manager.ts`、`input-queue.ts`、`types.ts`：导入 `Query` / `SDKMessage` / `SDKResultMessage` / `SDKUserMessage` 等类型。
  - `src/daemon.ts`：导入 `SDKMessage` / `SDKResultMessage` 做消息路由。
- **本地进程 / spawn**（grep `spawn|execa|child_process` 命中约 21 文件）：`src/spawn-env.ts`、`cmd-shim.ts`（子进程环境与命令封装）；`agent-detector.ts`、`cursor-version.ts`（宿主环境探测）；`terminal-launcher.ts`、`terminal-observer.ts`（终端观察/启动）；`workspace.ts`（工作目录解析与隔离）；`adapters/*.ts`（多种输出协议适配）。

## 5. 文件系统：workspace / worktree / 隔离

- **monorepo 工作区**：根 `package.json` 聚合 `backend` / `frontend` / `sillyhub-daemon` 三个子项目；各子项目各自 `pnpm@9.6.0`。
- **SillySpec 工作区**：`.sillyspec/`（changes / docs / knowledge / projects / quicklog / workflows / `sillyspec.db`）。
- **spec-workspaces 隔离**（Docker 部署）：backend 容器通过 bind mount 共享 `SPEC_DATA_HOST_DIR`（默认 `C:/data/spec-workspaces`）→ `/data/spec-workspaces`；并设 `SPEC_DATA_ROOT=/data/spec-workspaces`，以便宿主 daemon 与容器后端共享 spec 文档。
- **worktree 数据**：命名卷 `worktree-data` → `/data/sillyspec-workspaces`，设 `WORKTREE_BASE_DIR=/data/sillyspec-workspaces`。
- **宿主项目挂载**：`HOST_PROJECTS_DIR`（默认 `C:/Users/qinyi/IdeaProjects`）→ `/host-projects`，并通过 `HOST_PATH_PREFIX` / `CONTAINER_PATH_PREFIX` 做路径重写（commit `fcbf3fa7`：backend 生成宿主路径 prompt，daemon 零配置），使扫描器能在容器内读取宿主 `.sillyspec` 树。
- **scripts**：`scripts/migrate_scan_docs.py` 处理 scan 文档迁移（含 workspace 路径处理）。
- **spikes 中的隔离验证**：`spikes/01-git-isolation/`（run.sh / run.ps1）、`spikes/02-workspace-scan/`（scan.py + fixture）、`spikes/04-delegate-task/`、`spikes/05-mission-e2e/` 均涉及 worktree / workspace / isolation。

## 6. Docker / 容器编排

### 6.1 全栈 `deploy/docker-compose.yml`（name: `multi-agent-platform`）
| 服务 | 镜像 / 来源 | 端口 | 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | `5432` | — | 见 §1 |
| `redis` | `redis:7-alpine` | （未对外，仅容器内） | — | 见 §2，appendonly 持久化 |
| `backend` | `build context=../backend`（Dockerfile） | `8000` | `postgres`(healthy) / `redis`(healthy) | 启动命令 `alembic upgrade head && uvicorn app.main:app`；构建参数 `CLAUDE_CODE_VERSION=2.1.158` / `SILLYSPEC_VERSION=3.18.3` |
| `frontend` | `build context=../frontend`（Dockerfile） | `3000` | `backend` | 构建期注入 `INTERNAL_API_BASE_URL`（默认 `http://backend:8000`）/ `NEXT_PUBLIC_API_BASE_URL`（默认 `http://localhost:8000`） |

命名卷：`pgdata`、`redisdata`、`worktree-data`、`claude-data`；外加 bind mount：宿主项目目录、`SPEC_DATA_HOST_DIR`。

### 6.2 开发 `deploy/docker-compose.dev.yml`（name: `multi-agent-platform-dev`）
仅起依赖服务，backend / frontend 在宿主机以热重载方式运行（`uvicorn --reload` / `next dev`）：
- `postgres:16-alpine`，暴露 `${POSTGRES_PORT:-5432}`。
- `redis:7-alpine`，暴露 `${REDIS_PORT:-6379}`。

> 注：`deploy/` 下**没有** sillyhub-daemon 的 compose 服务 —— daemon 始终在宿主机本地运行（`daemon-start.bat` 等本地脚本拉起），与 backend 通过本地协议 / 网络交互。

## 7. 前端运行时集成（frontend/package.json 摘要）

- 框架：`next@14.2.5`、`react@18.3.1`、`react-dom@18.3.1`。
- UI：`antd@^6.4.4`、`@ant-design/icons`、`@ant-design/nextjs-registry`、`@radix-ui/*`、`lucide-react`、`tailwindcss@3.4.7` + `tailwindcss-animate`、`class-variance-authority` / `clsx` / `tailwind-merge`。
- 数据/状态：`@tanstack/react-query@^5.51`、`zustand@^4.5`、`zod@^3.23`。
- 可视化/流程：`@xyflow/react@^12.10`（拓扑流程图）、`echarts@^6.1` + `echarts-for-react`（图表）、`@uiw/react-markdown-preview`。
- 测试/E2E：`vitest`、`@testing-library/react`、`@playwright/test`、`puppeteer`、`jsdom`。
- 构建约定：`node>=20`，`packageManager=pnpm@9.6.0`。
