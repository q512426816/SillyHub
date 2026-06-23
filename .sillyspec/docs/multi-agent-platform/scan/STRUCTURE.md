---
source_commit: ba87eec
updated_at: 2026-06-23T16:35:25Z
created_at: 2026-06-24T00:35:25
author: qinyi
generator: sillyspec-scan
---

# multi-agent-platform — 项目结构（根 monorepo，组件视角）

> 由 `sillyspec-scan` 在 `ba87eec` 处对仓库根（path = `.`）做组件/子系统视角扫描生成。
> 覆盖 backend / frontend / sillyhub-daemon 三个子项目 + deploy 编排 + 辅助目录。
> 子项目各自的深度 scan 文档见 `.sillyspec/docs/<project>/scan/`，模块/流程文档见下方索引。

## 1. 顶层布局（组件视角）

```
multi-agent-platform/                # monorepo 根
├── backend/                         # 组件①：FastAPI + Python 3.12 后端 API（业务/编排/持久化）
├── frontend/                        # 组件②：Next.js 14 + React 18 Web 前端
├── sillyhub-daemon/                 # 组件③：本地守护进程（Node ≥20 ESM，驱动 Claude Agent SDK）
├── deploy/                          # Docker Compose 编排（full + dev）
├── docs/                            # 项目级设计文档 / QA / 参考资料
├── scripts/                         # 辅助维护脚本
├── spikes/                          # 技术探针（01-git-isolation ~ 05-mission-e2e）
├── data/                            # 本地 spec-storage 数据
├── backups/                         # 数据库备份
├── .sillyspec/                      # SillySpec 工作区（changes/docs/knowledge/projects/flows）
├── .claude/                         # Claude Code 项目约定（CLAUDE.md + hooks + skills）
├── Makefile                         # 常用命令（make up / test / lint）
├── README.md / AGENTS.md            # 项目总览 / Agent 行为约定
└── package.json                     # 根 package（聚合子项目，非真依赖）
```

## 2. 组件目录树与职责

### 2.1 backend/（API 后端组件）
```
backend/
├── app/
│   ├── main.py                      # FastAPI 应用入口（聚合 ~18 个模块路由，统一 /api 前缀）
│   ├── core/                        # 基础设施（redis 客户端、配置、安全、deps）
│   ├── models/                      # 共享 SQLModel 实体
│   └── modules/                     # 领域模块（每个含 router/service/schema/tests）
│       ├── auth/                    # 认证（JWT 登录/刷新/me/logout）
│       ├── admin/                   # 后台管理（组织树/角色/用户）
│       ├── workspace/ + members     # 工作区与成员管理
│       ├── agent/                   # Agent 执行/委派/日志
│       ├── daemon/                  # daemon 运行时（注册/心跳/会话/lease/run_sync/SSE/WS）
│       │   ├── router.py            # /api/daemon（register/heartbeat/sessions/ws）
│       │   ├── session/             # 交互式会话服务
│       │   ├── run_sync/            # run 日志同步 + Redis Pub/Sub → SSE 聚合
│       │   └── lease_service.py     # lease 租约与取消信号
│       ├── runtime/                 # 运行时抽象
│       ├── task/                    # 一次性任务
│       ├── change/ + change_writer/ # SillySpec 变更与文档写入
│       ├── workflow/                # 工作流编排
│       ├── worktree/                # git worktree 管理
│       ├── git_gateway/ + git_identity/  # git 网关与身份
│       ├── spec_workspace/          # spec 工作区隔离与 bootstrap
│       ├── scan_docs/               # 扫描文档读写
│       ├── ppm/                     # PPM（项目管理）业务模块
│       ├── incident/                # 事件
│       ├── knowledge/               # 知识库
│       ├── release/ + archive/      # 发布与归档
│       ├── health/                  # /api/health（db + redis 健康检查）
│       ├── settings/ + spec_profile/ + tool_gateway/
├── migrations/                      # alembic 版本
├── tests/ hooks/ scripts/
├── pyproject.toml                   # Python 3.12（fastapi/sqlmodel/asyncpg/redis/alembic）
├── Dockerfile + docker-entrypoint.sh
└── create_tables.py
```

### 2.2 frontend/（Web 前端组件）
```
frontend/
├── src/
│   ├── app/                         # Next.js App Router（(auth)/(dashboard)/api 路由组）
│   ├── components/
│   │   ├── layout/ ui/ charts/      # 通用布局/UI/图表
│   │   ├── daemon/                  # daemon 运行时（runtime-session-dialog / interactive-session-panel）
│   │   ├── agent-log/ permissions/  # Agent 日志 / 权限审批
│   │   ├── ppm-*.tsx                # PPM 业务组件群
│   │   ├── workspace-*.tsx          # 工作区组件群
│   │   └── app-shell.tsx top-bar.tsx
│   ├── lib/                         # api（apiFetch 401 refresh）/ auth / changes / workspace-members
│   ├── stores/ styles/ test/
├── public/
├── next.config.mjs                  # 含后端代理 INTERNAL_API_BASE_URL
├── tailwind.config.ts tsconfig.json vitest.config.ts
├── Dockerfile                       # 构建期注入 API base url
└── package.json                     # next 14.2.5 / react 18.3.1 / antd 6 / react-query / xyflow / echarts
```

### 2.3 sillyhub-daemon/（本地守护进程组件）
```
sillyhub-daemon/
├── src/
│   ├── index.ts cli.ts              # 入口
│   ├── daemon.ts                    # 主循环（ws + SDK 消息驱动）
│   ├── config.ts                    # 配置（heartbeat_interval=15 / lease_heartbeat_interval=5）
│   ├── protocol.ts types.ts         # 协议与类型
│   ├── ws-client.ts                 # daemon → backend WebSocket 实时通道（ws://）
│   ├── hub-client.ts                # backend HTTP 客户端（register/heartbeat/lease）
│   ├── interactive/                 # 交互式 Claude 会话
│   │   ├── session-manager.ts       # 会话生命周期（含远程人审 resolver/wsClient）
│   │   ├── claude-sdk-driver.ts     # @anthropic-ai/claude-agent-sdk 封装（query）
│   │   ├── input-queue.ts types.ts
│   ├── adapters/                    # 输出协议适配（stream-json/json-rpc/jsonl/ndjson）
│   ├── task-runner.ts               # 一次性任务 + lease heartbeat 循环
│   ├── credential.ts spawn-env.ts   # 凭证注入与子进程环境
│   ├── workspace.ts                 # 工作目录解析与隔离
│   ├── agent-detector.ts cursor-version.ts terminal-launcher.ts terminal-observer.ts
│   ├── spec-sync.ts file-rpc.ts cmd-shim.ts
│   └── daemon-version.ts version.ts
├── dist/ tests/
├── tsconfig.json vitest.config.ts
└── package.json                     # ESM / pnpm@9.6.0 / @anthropic-ai/claude-agent-sdk@0.3.181 / ws / commander
```

## 3. deploy 部署结构（Docker Compose 编排）

### 3.1 全栈 `deploy/docker-compose.yml`（name: `multi-agent-platform`）
| 服务 | 镜像/来源 | 端口 | 依赖 | 说明 |
| --- | --- | --- | --- | --- |
| `postgres` | `postgres:16-alpine` | `${POSTGRES_PORT:-5432}:5432` | — | 健康检查 `pg_isready`；命名卷 `pgdata` |
| `redis` | `redis:7-alpine` | 仅容器内 | — | `--appendonly yes` 持久化；命名卷 `redisdata` |
| `backend` | build `../backend` | `${BACKEND_PORT:-8000}:8000` | postgres(healthy) + redis(healthy) | 启动 `alembic upgrade head && uvicorn`；env_file `.env`；构建参数 `CLAUDE_CODE_VERSION` / `SILLYSPEC_VERSION` |
| `frontend` | build `../frontend` | `${FRONTEND_PORT:-3000}:3000` | `backend` | 构建期注入 `INTERNAL_API_BASE_URL`(默认 `http://backend:8000`) / `NEXT_PUBLIC_API_BASE_URL`(默认 `http://localhost:8000`) |

命名卷：`pgdata`、`redisdata`、`worktree-data`(`/data/sillyspec-workspaces`)、`claude-data`(`/app/.claude`)。
bind mount：`HOST_PROJECTS_DIR`(默认 `C:/Users/qinyi/IdeaProjects`)→`/host-projects`；`SPEC_DATA_HOST_DIR`(默认 `C:/data/spec-workspaces`)→`/data/spec-workspaces`。

> 注：`deploy/` **无 sillyhub-daemon 服务**——daemon 始终在宿主机本地运行，通过 WebSocket/HTTP 与 backend 交互。

### 3.2 开发 `deploy/docker-compose.dev.yml`（name: `multi-agent-platform-dev`）
仅起依赖：`postgres:16-alpine`（暴露 `${POSTGRES_PORT:-5432}`）+ `redis:7-alpine`（暴露 `${REDIS_PORT:-6379}`）。backend/frontend 在宿主机热重载运行。

## 4. 辅助目录

| 目录 | 职责 |
| --- | --- |
| `docs/` | 项目级设计文档：`change-center-redesign.md`、`claude-loop-v1-p0.md`、`execution-plan-v2-v5.md`、`spec-alignment.md`、`agent-sillyspec-stage-execution-analysis.md`、`sillyspec-tool-side-requirements.md`、`qa/`、`sillyhub_refs/` |
| `spikes/` | 技术探针：`01-git-isolation/`、`02-workspace-scan/`、`03-claude-code/`、`04-delegate-task/`、`05-mission-e2e/` + `README.md`/`REPORT.md` |
| `scripts/` | `migrate_scan_docs.py`（scan 文档迁移，含 workspace 路径处理） |
| `data/` | `spec-storage/`（本地 spec 数据） |
| `backups/` | 数据库备份（如 `db-backup-20260622-084553.sql`） |

## 5. 文档索引（跨组件）

### 模块文档（组件视角，`.sillyspec/docs/multi-agent-platform/modules/`）
`_module-map.yaml`、`backend.md`、`frontend.md`、`sillyhub-daemon.md`、`deploy.md`、`build.md`、`ci.md`、`docs.md`、`prototype.md`、`spikes.md`、`sillyspec.md`。

### 跨组件流程文档（`.sillyspec/docs/multi-agent-platform/flows/`）
`agent-execution.md`、`agent-run-flow.md`、`auth-flow.md`、`change-lifecycle.md`、`sillyspec-workflow.md`、`workspace-scan-bootstrap.md`。

### scan 文档位置
- 根 monorepo（本文档所在）：`.sillyspec/docs/multi-agent-platform/scan/`
- 各子项目深度 scan：`.sillyspec/docs/backend/scan/`、`.sillyspec/docs/frontend/scan/`、`.sillyspec/docs/sillyhub-daemon/scan/`
