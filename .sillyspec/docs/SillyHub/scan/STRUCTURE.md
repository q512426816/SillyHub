---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 5a00fc7e
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 目录结构(Structure)

SillyHub 仓库根(`multi-agent-platform/`)采用 monorepo 布局,核心三端:`backend/`(FastAPI)、`frontend/`(Next.js 14)、`sillyhub-daemon/`(Node.js 本地执行守护)。此外包含 `deploy/`(docker compose)、`docs/`、`scripts/`、`spikes/`、`.claude/`(技能与规则)。

## 1. 仓库根顶层布局

```
multi-agent-platform/
├── backend/            # FastAPI 后端(Python 3.12,uv 管理)
├── frontend/           # Next.js 14 前端(pnpm 管理)
├── sillyhub-daemon/    # 本地任务执行守护(Node.js,与 backend 通过 WS 通信)
├── deploy/             # docker-compose.yml / .env / 镜像产物
├── docs/               # 项目文档(审计/设计/坑记录)
├── scripts/            # 仓库级辅助脚本
├── spikes/             # 调研/原型目录
├── .claude/            # Claude Code 配置 + skills + hooks + agents
├── .sillyspec/         # SillySpec 工作区(changes/docs/knowledge/quicklog/db)
├── Makefile            # 顶层 make 目标(up/test/lint 等)
├── ROADMAP.md / AGENTS.md / README.md
└── meta.json
```

## 2. backend(FastAPI + Python 3.12)

```
backend/
├── app/
│   ├── main.py             # FastAPI 入口,挂载所有 router / 中间件 / 生命周期
│   ├── core/               # 横切基础设施
│   │   ├── config.py                        # 配置(pydantic-settings)
│   │   ├── db.py redis.py                   # asyncpg/SQLAlchemy 会话、Redis 客户端
│   │   ├── security.py crypto.py            # 鉴权、加解密
│   │   ├── auth_deps.py permission_cache.py # 鉴权依赖、权限缓存
│   │   ├── audit_hooks.py errors.py logging.py telemetry.py
│   │   ├── paths.py spec_paths.py           # 路径 / spec 目录解析
│   │   └── tests/
│   ├── models/base.py      # SQLModel 基类
│   └── modules/            # 业务模块(每个目录一个领域,vertical slice)
│       ├── admin/ auth/                       # 用户/角色/权限/登录
│       ├── workspace/ spec_workspace/ spec_profile/   # 工作区 + SillySpec 目录
│       ├── change/ change_writer/ workflow/           # 变更流程 / spec 写回
│       ├── scan_docs/ knowledge/ skills/              # 文档扫描 / 知识库 / 技能
│       ├── task/ runtime/ agent/                      # 任务 / 运行时 / Agent 编排
│       ├── daemon/                                   # daemon 实体 + 实例绑定
│       ├── llm_provider/                             # Claude/Codex 等模型供应商
│       ├── tool_gateway/ git_gateway/ git_identity/  # 工具网关 / Git 凭证
│       ├── file/ storage/                           # 平台文件中心(MinIO/S3)
│       ├── ppm/                                     # 项目/问题管理(PPM)
│       ├── incident/ release/ health/ settings/
│       └── worktree/                                # worktree 生命周期
├── migrations/             # Alembic(env.py + versions/)
├── tests/                  # core/ modules/ e2e/ + 顶层集成测试
├── hooks/ templates/ scripts/
├── alembic.ini pyproject.toml ruff.toml uv.lock
├── Dockerfile docker-entrypoint.sh
└── seed_workbench_demo.py
```

## 3. frontend(Next.js 14 App Router)

源码集中在 `frontend/src/`(注意:非顶层 `app/`)。

```
frontend/
├── src/
│   ├── app/                 # Next.js App Router 路由
│   │   ├── (auth)/ (dashboard)/     # 路由分组(登录态 / 工作台)
│   │   ├── api/                     # Next.js API 路由(BFF 代理)
│   │   ├── m/                       # 移动端路由
│   │   ├── layout.tsx page.tsx globals.css
│   │   └── error.tsx global-error.tsx
│   ├── components/          # UI 组件(按域分子目录 + 大量顶层 .tsx)
│   │   ├── agent/ agent-log/ changes/ daemon/
│   │   ├── llm-providers/ workspace/ ppm/ permissions/
│   │   ├── charts/ layout/ mobile/ ui/
│   │   └── app-shell.tsx top-bar.tsx mission-console.tsx file-upload.tsx ...
│   ├── lib/                 # 前端业务逻辑层
│   │   ├── api/ auth/ file/ ppm/     # 子域 API 客户端
│   │   ├── api.ts api-types.ts query-client.ts query-keys.ts
│   │   ├── agent.ts agent-stream.ts daemon.ts runtime.ts workspaces.ts
│   │   └── 各 use-* hook + 工具模块
│   ├── stores/              # zustand:session / workspace / kanban
│   ├── styles/              # fonts / tokens / index
│   ├── middleware.ts        # 路由守卫(工作区/鉴权重定向)
│   └── test/
├── public/ scripts/
├── next.config.mjs tailwind.config.ts tsconfig.json
├── vitest.config.ts components.json postcss.config.mjs
├── package.json pnpm-lock.yaml Dockerfile
└── .env.example
```

## 4. sillyhub-daemon(Node.js 本地执行守护)

TypeScript 源码,经 `pnpm bundle`(`@vercel/ncc`)打成单文件 `sillyhub-daemon.js`,由 backend 容器分发到本机。

```
sillyhub-daemon/
├── src/
│   ├── cli.ts index.ts              # CLI 入口(commander)
│   ├── daemon.ts                    # WS 守护主循环
│   ├── hub-client.ts ws-client.ts   # 与 backend 的 WS / HTTP 通信
│   ├── task-runner.ts               # 任务执行(批/交互式 lease)
│   ├── config.ts credential.ts credential-injector.ts spawn-env.ts
│   ├── mcp-server.ts mcp-config.ts  # 作为 MCP server 暴露工具
│   ├── spec-sync.ts workspace.ts roots-rpc.ts file-rpc.ts host-fs-handler.ts
│   ├── skill-manager.ts agent-detector.ts permission-rules.ts runtime-lock.ts
│   ├── terminal-launcher.ts terminal-observer.ts
│   ├── preflight.ts protocol.ts types.ts tool-kind.ts
│   ├── daemon-version.ts cursor-version.ts build-id.ts version.ts cmd-shim.ts
│   ├── api-types.ts                 # 由 backend openapi 生成
│   ├── adapters/                    # 多种消息协议适配
│   │   ├── json-rpc.ts jsonl.ts ndjson.ts pi-json.ts stream-json.ts text.ts
│   │   └── protocol-adapter.ts index.ts
│   ├── interactive/                 # 交互式会话(Claude / Codex)
│   │   ├── claude-sdk-driver.ts codex-app-server-driver.ts driver.ts
│   │   ├── session-manager.ts session-store-persistence.ts
│   │   ├── input-queue.ts permission-resolver.ts types.ts
│   ├── policy/                      # 文件系统 / 运行时策略 + 审计
│   │   ├── filesystem-policy.ts runtime-policy.ts audit-sink.ts
│   │   └── path-utils.ts shell-paths.ts
│   └── resilience/                  # 网络韧性(outbox / 错误分类)
│       ├── outbox.ts error-classify.ts service.ts
├── scripts/                         # build-bundle.sh / install.sh / install.ps1 / gen-api-types.mjs
├── spikes/ tests/
├── tsconfig.json vitest.config.ts vitest.spikes.config.ts
└── package.json pnpm-lock.yaml
```

## 5. deploy(Docker Compose 编排)

```
deploy/
├── docker-compose.yml      # postgres + redis + minio + backend + frontend
├── docker-compose.dev.yml  # 开发覆盖(仅依赖服务)
├── .env .env.example       # 运行时配置(SECRET_KEY / MINIO / COMMIT_SHA 等)
└── images.tar.gz           # 镜像 save 产物(供服务器 load)
```

全栈 compose 启动 5 个服务:`postgres`(16-alpine)、`redis`(7-alpine)、`minio`(latest)、`backend`(本地 build,镜像名 `multi-agent-platform-backend:latest`)、`frontend`(本地 build,镜像名 `multi-agent-platform-frontend:latest`)。命名卷:`pgdata`、`redisdata`、`worktree-data`、`claude-data`、`minio-data`。**daemon 不在 compose 中**——始终在本机宿主运行,经 WebSocket 连 backend。
