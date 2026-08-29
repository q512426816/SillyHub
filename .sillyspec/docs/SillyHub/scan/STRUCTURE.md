---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 目录结构（Structure）

SillyHub 仓库根（`multi-agent-platform/`）为 monorepo 布局，核心三端：`backend/`（FastAPI）、`frontend/`(Next.js 14)、`sillyhub-daemon/`（Node.js 本地执行守护）。另含 `deploy/`（compose + LiteLLM 网关配置）、`docs/`、`scripts/`、`spikes/`、`.claude/`、`.codex/`、`.sillyspec/`（SillySpec 工作区）。基于 744e3de4 全量重扫。

## 1. 仓库根顶层布局

```
multi-agent-platform/
├── backend/            # FastAPI 后端(Python 3.12,uv 管理)
├── frontend/           # Next.js 14 前端(pnpm 管理)
├── sillyhub-daemon/    # 本地任务执行守护(Node.js,WS 连 backend)
├── deploy/             # docker-compose + LiteLLM 网关配置 + 部署脚本
├── docs/               # 项目文档(架构/审计/坑记录/sillyspec/integrations/mcp)
├── scripts/            # 仓库级辅助脚本(migrate_scan_docs/scan-drift-check 等)
├── spikes/             # 调研/原型目录(git-isolation/workspace-scan/mcp-fastmcp 等)
├── .claude/            # Claude Code 配置 + skills + hooks
├── .codex/             # Codex 技能镜像(sillyspec-* 技能)
├── .github/            # CI workflow
├── .sillyspec/         # SillySpec 工作区(changes/docs/projects/quicklog/workflows)
├── Makefile            # 顶层 make 目标(up/test/lint 等)
├── README.md / AGENTS.md / CLAUDE.md
└── node_modules/       # 根级 husky/lint-staged 等工具依赖
```

## 2. backend（FastAPI + Python 3.12）

```
backend/
├── app/
│   ├── main.py             # FastAPI 入口,挂载所有 router / MCP 子应用 / 中间件
│   ├── core/               # 横切基础设施
│   │   ├── config.py                        # 配置(pydantic-settings)
│   │   ├── db.py redis.py                   # asyncpg/SQLAlchemy 会话、Redis 客户端
│   │   ├── security.py crypto.py            # 鉴权、加解密
│   │   ├── auth_deps.py permission_cache.py # 鉴权依赖、权限缓存
│   │   ├── ssrf.py                          # SSRF 防护(getaddrinfo 校验)
│   │   ├── audit_hooks.py errors.py logging.py telemetry.py monitoring.py
│   │   ├── paths.py spec_paths.py           # 路径 / spec 目录解析
│   │   └── tests/
│   ├── models/base.py      # SQLModel 基类
│   └── modules/            # 业务模块(vertical slice,每目录一领域)
│       ├── admin/ auth/                          # 用户/角色/权限/登录
│       ├── workspace/ spec_workspace/ spec_profile/   # 工作区 + SillySpec 目录/档案
│       ├── change/ change_writer/ workflow/      # 变更流程 / spec 写回
│       ├── scan_docs/ knowledge/ skills/         # 文档扫描 / 知识库 / 技能
│       ├── task/ runtime/ agent/                 # 任务 / 运行时 / Agent 编排
│       ├── daemon/                               # daemon 实体 + WS 通道 + 会话 SSE
│       ├── llm_provider/                         # 模型供应商(Claude 直连 + LiteLLM 网关)
│       ├── mcp_gateway/                          # 对外 MCP 服务(FastMCP mount,server/tools/sse)
│       ├── platform_sync/                        # 跨仓进度同步(shpsync_ token + spec manifest/sync/bundle 拉取)
│       ├── tool_gateway/ git_gateway/ git_identity/   # 工具网关 / Git 凭证
│       ├── file/ storage/                        # 平台文件中心(MinIO/S3)
│       ├── ppm/                                  # 项目/问题管理(PPM)
│       ├── incident/ release/ health/ settings/
│       └── worktree/                             # worktree 生命周期
├── migrations/             # Alembic(env.py + versions/)
├── tests/                  # core/ modules/ e2e/ + 顶层集成测试
├── hooks/ templates/ scripts/
├── openapi.json            # OpenAPI schema 产物(供前端/daemon gen:types)
├── alembic.ini pyproject.toml ruff.toml uv.lock
├── Dockerfile docker-entrypoint.sh
└── seed_workbench_demo.py create_tables.py conftest.py
```

## 3. frontend（Next.js 14 App Router）

源码集中在 `frontend/src/`（注意：非顶层 `app/`）。

```
frontend/
├── src/
│   ├── app/                 # Next.js App Router 路由
│   │   ├── (auth)/ (dashboard)/     # 路由分组(登录态 / 工作台)
│   │   ├── api/                     # Next.js API 路由(BFF:daemon/daemon-chat/workspaces)
│   │   ├── m/                       # 移动端路由
│   │   └── layout.tsx page.tsx error.tsx global-error.tsx globals.css
│   ├── components/          # UI 组件(按域分子目录 + 顶层 .tsx)
│   │   ├── agent/ agent-log/ agent-profile/ changes/ daemon/
│   │   ├── llm-providers/ workspace/ sessions/ ppm/ permissions/
│   │   ├── charts/ layout/ mobile/ ui/ __tests__/
│   │   └── app-shell.tsx top-bar.tsx mission-console.tsx file-upload.tsx
│   │       delete-change-confirm.tsx ...          # 变更删除受控确认弹层(2026-08-29-change-delete-closure-and-spec-pull;
│   │                                              #   活动徽标在 changes/change-activity-badge.tsx)
│   ├── lib/                 # 前端业务逻辑层
│   │   ├── api/ auth/ file/ ppm/     # 子域 API 客户端
│   │   ├── api.ts api-types.ts query-client.ts query-keys.ts
│   │   ├── fetch-sse.ts agent-stream.ts daemon.ts runtime.ts workspace*.ts
│   │   ├── mcp-tokens.ts mcp-settings.ts quicklog.ts audit.ts incidents.ts releases.ts
│   │   └── use-* hooks + 工具模块(use-agent-run-stream / use-daemon-machines 等)
│   ├── config/              # 静态配置(llmProviderPresets.ts)
│   ├── stores/              # zustand:session / workspace / kanban
│   ├── styles/              # fonts / tokens / index
│   ├── middleware.ts        # 路由守卫(工作区/鉴权重定向)
│   └── test/
├── public/ scripts/
├── next.config.mjs tailwind.config.ts tsconfig.json
├── vitest.config.ts components.json postcss.config.mjs
├── package.json pnpm-lock.yaml Dockerfile
└── scripts/gen-api-types.mjs   # 由 backend openapi.json 生成 src/lib/api-types.ts
```

## 4. sillyhub-daemon（Node.js 本地执行守护）

TypeScript 源码，经 `pnpm bundle`（`@vercel/ncc`）打成单文件分发，由 backend 容器下发到本机。

```
sillyhub-daemon/
├── src/
│   ├── cli.ts index.ts              # CLI 入口(commander)
│   ├── daemon.ts                    # WS 守护主循环
│   ├── hub-client.ts ws-client.ts   # 与 backend 的 WS / HTTP 通信
│   ├── task-runner.ts               # 任务执行(批/交互式 lease)
│   ├── config.ts credential.ts credential-injector.ts spawn-env.ts
│   ├── claude-settings.ts           # Claude Code settings.json 注入
│   ├── local-yaml-writer.ts         # 写 .sillyspec/local.yaml(platform/mcp 段)
│   ├── mcp-server.ts mcp-config.ts  # 作为 MCP server 暴露工具
│   ├── spec-sync.ts workspace.ts roots-rpc.ts file-rpc.ts host-fs-handler.ts
│   ├── skill-manager.ts agent-detector.ts permission-rules.ts runtime-lock.ts
│   ├── terminal-launcher.ts terminal-observer.ts
│   ├── preflight.ts protocol.ts types.ts tool-kind.ts
│   ├── daemon-version.ts cursor-version.ts build-id.ts version.ts cmd-shim.ts
│   ├── api-types.ts                 # 由 backend openapi 生成(scripts/gen-api-types.mjs)
│   ├── model-error/                 # 模型调用错误分类
│   ├── adapters/                    # 多协议消息适配
│   │   ├── json-rpc.ts jsonl.ts ndjson.ts pi-json.ts stream-json.ts text.ts
│   ├── interactive/                 # 交互式会话(Claude / Codex)
│   │   ├── claude-sdk-driver.ts codex-app-server-driver.ts driver.ts
│   │   ├── session-manager.ts session-store-persistence.ts
│   │   └── input-queue.ts permission-resolver.ts types.ts
│   ├── policy/                      # 文件系统 / 运行时策略 + 审计
│   │   ├── filesystem-policy.ts runtime-policy.ts audit-sink.ts
│   │   └── path-utils.ts shell-paths.ts
│   └── resilience/                  # 网络韧性(outbox / 错误分类)
│       ├── outbox.ts error-classify.ts service.ts
├── scripts/                         # build-bundle.sh / install.sh / install.ps1 / gen-api-types.mjs
├── build/ dist/ spikes/ tests/
├── tsconfig.json vitest.config.ts vitest.spikes.config.ts
└── package.json pnpm-lock.yaml
```

## 5. deploy（Docker Compose 编排 + LLM 网关）

```
deploy/
├── docker-compose.yml      # 7 服务:postgres/redis/minio/backend/frontend/litellm-db/litellm
├── docker-compose.dev.yml  # 开发覆盖(仅依赖服务)
├── litellm-config.yaml     # LiteLLM 网关配置(admin API 动态注册,drop_params)
├── .env .env.example       # 运行时配置(SECRET_KEY / MINIO / LITELLM_MASTER_KEY 等)
├── scripts/                # 部署辅助脚本
├── timed-log.conf          # nginx/前端定时日志配置
└── images.tar.gz           # 镜像 save 产物(供服务器 load)
```

compose 7 服务：`postgres`(16-alpine)、`redis`(7-alpine)、`minio`、`backend`(本地 build `multi-agent-platform-backend:latest`)、`frontend`(本地 build `-frontend:latest`)、`litellm-db`(postgres 16，LiteLLM 专用)、`litellm`(`ghcr.io/berriai/litellm:v1.95.0`)。命名卷：`pgdata`、`redisdata`、`litellm-db-data`、`worktree-data`、`claude-data`、`minio-data`。**daemon 不在 compose 中**——始终在本机宿主运行，经 WebSocket 连 backend。

## 6. .sillyspec（SillySpec 工作区）

```
.sillyspec/
├── ROADMAP.md          # 项目路线图
├── changes/            # 活跃 change(四件套)+ archive/ 归档
├── docs/               # 按项目分组的知识库(SillyHub/backend/frontend/sillyhub-daemon/multi-agent-platform)
├── knowledge/          # 全局知识条目
├── projects/           # 多项目定义卡(每项目一 YAML)
├── quicklog/           # quick 流程 QUICKLOG 条目文件
├── workflows/          # 自定义工作流(scan-docs/archive-impact)
├── shared/             # 跨项目共享(当前为空)
├── workspace/          # 工作区运行时目录
└── local.yaml(.example) # 本机实例配置(platform 同步 / mcp 派发段)
```
