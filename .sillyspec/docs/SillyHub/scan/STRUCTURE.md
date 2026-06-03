---
author: qinyi
created_at: 2026-06-03T20:35:00+08:00
---

# STRUCTURE.md — SillyHub 目录结构和文件组织

## 根目录结构

```
multi-agent-platform/
├── .claude/                 ← Claude Code 配置
│   ├── CLAUDE.md            ← 项目级开发规则（SillySpec 流程 + 执行顺序）
│   ├── settings.json        ← Claude Code 权限和钩子配置
│   └── worktrees/           ← Claude Code 工作树（gitignored）
├── .editorconfig            ← 编辑器统一配置（UTF-8, LF, 2空格, Python 4空格）
├── .gitignore               ← Git 忽略规则
├── .github/
│   └── workflows/
│       ├── backend-ci.yml   ← 后端 CI 流水线（ruff + mypy + pytest）
│       └── frontend-ci.yml  ← 前端 CI 流水线（lint + typecheck + test + build）
├── .idea/                   ← IntelliJ IDEA 配置（gitignored）
├── .playwright-mcp/         ← Playwright MCP 配置（gitignored）
├── .pytest_cache/           ← pytest 缓存（gitignored）
├── .ruff_cache/             ← Ruff 缓存（gitignored）
├── .sillyspec/              ← SillySpec 文档系统
│   ├── .runtime/            ← 运行时状态（gitignored）
│   ├── changes/             ← 变更文档（活跃 + 归档）
│   │   ├── archive/         ← 已归档变更包（13 个已完成的变更）
│   │   ├── default/         ← 当前活跃变更
│   │   └── ...              ← 其他活跃变更包
│   ├── docs/                ← 模块文档和扫描文档
│   │   ├── SillyHub/        ← 主项目文档
│   │   │   ├── modules/     ← 模块文档（change_writer.md, git_gateway.md）
│   │   │   └── scan/        ← 扫描文档（7 份，本文件所在目录）
│   │   ├── backend/         ← 后端扫描文档
│   │   ├── frontend/        ← 前端扫描文档
│   │   └── multi-agent-platform/ ← 历史文档
│   ├── knowledge/           ← 知识库
│   │   └── INDEX.md         ← 知识条目索引
│   ├── progress.json        ← SillySpec 进度状态（当前无活跃变更）
│   ├── projects/            ← 子项目注册
│   │   ├── SillyHub.yaml    ← monorepo 定义（type: platform, role: monorepo）
│   │   ├── backend.yaml     ← 后端子项目
│   │   └── frontend.yaml    ← 前端子项目（声明 depends_on backend）
│   └── quicklog/            ← 快速日志
├── .venv-spike/             ← Spike 专用虚拟环境（gitignored）
├── CLAUDE.md                ← 项目级 CLAUDE 说明（技术栈 + 项目结构 + 开发规则）
├── Makefile                 ← 顶层构建命令（dev-up, test, lint, up/down 等）
├── README.md                ← 项目 README
├── backend/                 ← 后端项目（详见下方）
├── deploy/                  ← 部署配置（详见下方）
├── docs/                    ← 项目文档（非 SillySpec）
│   ├── qa/                  ← QA 文档
│   ├── sillyhub_refs/       ← SillyHub 参考文档
│   ├── agent-sillyspec-stage-execution-analysis.md
│   ├── change-center-redesign.md
│   ├── claude-loop-v1-p0.md
│   ├── execution-plan-v2-v5.md
│   └── spec-alignment.md
├── frontend/                ← 前端项目（详见下方）
└── spikes/                  ← 技术调研
    ├── 01-git-isolation/    ← Git 凭据隔离验证（run.ps1）
    ├── 02-workspace-scan/   ← Workspace 扫描验证（scan.py）
    ├── 03-claude-code/      ← Claude Code 受控验证
    ├── README.md            ← Spike 概述（3/3 PASS，V1 门禁解除）
    └── REPORT.md            ← Spike 结果报告
```

## 后端目录结构（backend/）

```
backend/
├── .dockerignore
├── .env.example             ← 后端环境变量模板
├── Dockerfile               ← 多阶段 Docker 构建
├── README.md
├── alembic.ini              ← Alembic 配置（URL 从环境变量读取）
├── app/
│   ├── __init__.py          ← 版本号定义（__version__）
│   ├── main.py              ← FastAPI 应用入口（create_app + lifespan + 路由注册）
│   ├── core/                ← 基础设施层（13 个模块）
│   │   ├── __init__.py
│   │   ├── audit_hooks.py   ← 审计钩子
│   │   ├── auth_deps.py     ← 认证依赖注入（get_current_user, require_role）
│   │   ├── config.py        ← pydantic-settings（Settings 类，完整环境变量映射）
│   │   ├── crypto.py        ← NaCl secretbox 加密/解密
│   │   ├── db.py            ← 数据库连接池、会话工厂、init/dispose
│   │   ├── errors.py        ← 统一异常体系（AppError 层次结构）
│   │   ├── layout_migration.py ← SillySpec 布局迁移工具
│   │   ├── logging.py       ← structlog 配置
│   │   ├── redis.py         ← Redis 连接管理
│   │   ├── security.py      ← JWT + 密码哈希（passlib bcrypt）
│   │   ├── spec_paths.py    ← SillySpec 路径解析
│   │   └── telemetry.py     ← OpenTelemetry 初始化
│   ├── models/              ← 共享 SQLModel 基类和枚举
│   └── modules/             ← 业务模块（23 个垂直切片）
│       ├── __init__.py
│       ├── agent/           ← Agent 运行管理（AgentRun CRUD + subprocess 调度）
│       ├── archive/         ← 归档管理（变更包归档）
│       ├── auth/            ← 认证和 RBAC（登录、角色、权限种子）
│       ├── change/          ← 变更管理（10 阶段工作流）
│       ├── change_writer/   ← 变更文件写入（SillySpec 文档生成）
│       ├── git_gateway/     ← Git 操作网关（白名单 + 审计）
│       ├── git_identity/    ← Git 身份管理（多身份 + PAT 加密）
│       ├── health/          ← 健康检查探针
│       ├── incident/        ← 事件管理
│       ├── knowledge/       ← 知识库
│       ├── release/         ← 发布管理
│       ├── runtime/         ← 运行时管理
│       ├── scan_docs/       ← 扫描文档管理（单组件解析/软删除）
│       ├── settings/        ← 平台设置
│       ├── spec_profile/    ← SillySpec 配置
│       ├── spec_workspace/  ← SillySpec 工作区
│       ├── task/            ← 任务管理
│       ├── tool_gateway/    ← 工具网关（策略 + 审计）
│       ├── workflow/        ← 工作流引擎（FSM 状态机）
│       ├── workspace/       ← 工作区管理（CRUD + 组件拓扑）
│       └── worktree/        ← Worktree 管理（创建/租约/清理）
├── conftest.py              ← pytest 全局 fixtures（async DB、test client）
├── create_tables.py         ← 手动建表脚本（开发用）
├── docker-entrypoint.sh     ← Docker 入口脚本
├── migrations/              ← Alembic 迁移
│   ├── env.py               ← Alembic 环境配置（从 Settings 读取 DATABASE_URL）
│   ├── script.py.mako       ← 迁移模板
│   └── versions/            ← 迁移版本文件（32 个）
├── pyproject.toml           ← Python 项目配置（依赖 + pytest + mypy + ruff）
├── ruff.toml                ← Ruff 配置（extend pyproject.toml）
├── tests/                   ← 测试
│   ├── __init__.py
│   ├── test_config.py       ← 配置测试
│   ├── test_health.py       ← 健康检查测试
│   └── modules/             ← 模块级测试
│       ├── agent/           ← Agent 模块测试
│       ├── change/          ← 变更模块测试
│       ├── change_writer/   ← 变更写入测试
│       └── workspace/       ← 工作区测试
└── uv.lock                  ← uv 锁文件
```

## 前端目录结构（frontend/）

```
frontend/
├── .dockerignore
├── .env.example             ← 前端环境变量模板（NEXT_PUBLIC_API_BASE_URL）
├── .eslintrc.json           ← ESLint 配置
├── Dockerfile               ← 多阶段构建（deps → builder → runtime, standalone 输出）
├── components.json          ← shadcn/ui 配置
├── next-env.d.ts
├── next.config.mjs          ← Next.js 配置（standalone + API rewrite 代理）
├── package.json             ← 依赖声明 + 脚本（dev/build/test/lint/typecheck）
├── package-lock.json
├── pnpm-lock.yaml
├── postcss.config.mjs
├── public/                  ← 静态资源
├── src/
│   ├── app/                 ← Next.js App Router
│   │   ├── globals.css      ← 全局样式（Tailwind 指令 + 自定义变量）
│   │   ├── layout.tsx       ← 根布局
│   │   ├── page.tsx         ← 首页（工作区列表 + 健康检查）
│   │   ├── (auth)/          ← 认证路由组
│   │   │   └── login/page.tsx ← 登录页
│   │   ├── (dashboard)/     ← 仪表盘路由组（需登录）
│   │   │   ├── layout.tsx   ← 仪表盘布局（含侧边栏）
│   │   │   ├── settings/    ← 设置页
│   │   │   │   ├── page.tsx ← 平台设置
│   │   │   │   └── git-identities/page.tsx ← Git 身份管理
│   │   │   └── workspaces/  ← 工作区
│   │   │       ├── page.tsx ← 工作区列表
│   │   │       └── [id]/    ← 工作区详情（含 12 个子页面）
│   │   └── api/             ← API Route Handlers
│   │       └── workspaces/[workspaceId]/agent/runs/[runId]/stream/
│   │           └── route.ts ← SSE 流式代理（转发后端 SSE 到前端）
│   ├── components/          ← React 组件
│   │   ├── app-shell.tsx    ← 应用外壳（导航 + 侧边栏）
│   │   ├── component-detail-drawer.tsx ← 组件详情抽屉
│   │   ├── health-card.tsx  ← 健康检查卡片
│   │   ├── sillyspec-step-progress.tsx ← SillySpec 步骤进度
│   │   ├── workspace-card.tsx ← 工作区卡片
│   │   ├── workspace-scan-dialog.tsx ← 工作区扫描对话框
│   │   └── ui/              ← 基础 UI 组件（shadcn/ui 风格）
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       └── input.tsx
│   ├── lib/                 ← API 客户端（30+ 模块 API 封装）和工具
│   │   ├── __tests__/       ← lib 层测试
│   │   │   ├── agent.test.ts
│   │   │   ├── api.test.ts
│   │   │   └── spec-workspaces.test.ts
│   │   ├── api.ts           ← 基础 API 封装（fetch + JWT + 错误处理）
│   │   ├── agent-stream.ts  ← Agent SSE 流客户端
│   │   ├── agent.ts         ← Agent API
│   │   ├── approvals.ts     ← 审批 API
│   │   ├── archive.ts       ← 归档 API
│   │   ├── audit.ts         ← 审计 API
│   │   ├── auth.ts          ← 认证 API
│   │   ├── change-writer.ts ← 变更写入 API
│   │   ├── changes.ts       ← 变更管理 API
│   │   ├── components.ts    ← 组件 API
│   │   ├── git-gateway.ts   ← Git 网关 API
│   │   ├── git-identities.ts ← Git 身份 API
│   │   ├── health.ts        ← 健康检查 API
│   │   ├── incidents.ts     ← 事件 API
│   │   ├── knowledge.ts     ← 知识库 API
│   │   ├── releases.ts      ← 发布 API
│   │   ├── runtime.ts       ← 运行时 API
│   │   ├── scan-docs.ts     ← 扫描文档 API
│   │   ├── settings.ts      ← 设置 API
│   │   ├── spec-workspaces.ts ← SillySpec 工作区 API
│   │   ├── tasks.ts         ← 任务 API
│   │   ├── tool-gateway.ts  ← 工具网关 API
│   │   ├── utils.ts         ← 工具函数（cn = clsx + tailwind-merge）
│   │   ├── workflow.ts      ← 工作流 API
│   │   ├── workspaces.ts    ← 工作区 API
│   │   └── worktree.ts      ← Worktree API
│   ├── stores/              ← Zustand 状态管理
│   │   └── session.ts       ← 会话状态（token, user）
│   └── test/                ← 测试设置
│       └── setup.ts         ← vitest 全局设置
├── tailwind.config.ts       ← Tailwind 配置
├── tsconfig.json            ← TypeScript 配置（strict + noUncheckedIndexedAccess）
└── vitest.config.ts         ← vitest 配置（jsdom + react plugin）
```

## 部署目录结构（deploy/）

```
deploy/
├── .env                     ← 运行时环境变量（gitignored，包含所有敏感配置）
├── .env.example             ← 环境变量模板（PostgreSQL/Redis/Backend/Frontend/Claude Code/Auth 配置）
├── docker-compose.yml       ← 全栈部署配置（4 服务 + 5 持久卷）
└── docker-compose.dev.yml   ← 开发依赖配置（仅 postgres + redis）
```

## Spikes 目录结构（spikes/）

```
spikes/
├── 01-git-isolation/        ← Spike 1: Git 凭据隔离
│   ├── README.md            ← PASS 条件和测试步骤
│   └── run.ps1              ← Windows PowerShell 执行脚本
├── 02-workspace-scan/       ← Spike 2: SillySpec 目录解析
│   ├── README.md
│   ├── scan.py              ← Python 扫描脚本
│   └── requirements.txt
├── 03-claude-code/          ← Spike 3: Claude Code 子进程可控性
│   ├── README.md
│   └── requirements.txt
├── README.md                ← Spike 概述（3/3 PASS, V1 门禁解除）
└── REPORT.md                ← 全部 Spike 结果报告
```

## 配置文件索引

| 文件 | 用途 |
|------|------|
| `Makefile` | dev/test/lint/deploy 快捷命令 |
| `.editorconfig` | 编辑器统一（2 空格、Python 4 空格、LF、UTF-8） |
| `.gitignore` | Python/Node/Docker/SillySpec/IDE 忽略 |
| `deploy/.env.example` | 环境变量模板（含 Claude Code 配置、Auth 引导、API 超时） |
| `deploy/docker-compose.yml` | 全栈编排（postgres + redis + backend + frontend） |
| `deploy/docker-compose.dev.yml` | 开发依赖（postgres + redis，端口映射到宿主机） |
| `.github/workflows/backend-ci.yml` | 后端 CI（ruff + mypy + pytest） |
| `.github/workflows/frontend-ci.yml` | 前端 CI（lint + typecheck + test + build） |
| `CLAUDE.md` | 项目级说明（技术栈 + 项目结构 + 开发规则） |
| `.claude/CLAUDE.md` | 开发流程规则（SillySpec 流程 + 执行顺序） |
| `backend/pyproject.toml` | Python 依赖 + pytest + mypy + ruff 配置 |
| `backend/ruff.toml` | Ruff 配置（extend pyproject.toml） |
| `backend/alembic.ini` | Alembic 配置 |
| `frontend/package.json` | 前端依赖 + 脚本 |
| `frontend/tsconfig.json` | TypeScript 配置 |
| `frontend/vitest.config.ts` | vitest 配置 |
| `frontend/next.config.mjs` | Next.js 配置 |
| `frontend/tailwind.config.ts` | Tailwind 配置 |
| `.sillyspec/projects/SillyHub.yaml` | monorepo 定义 |
| `.sillyspec/projects/backend.yaml` | 后端子项目 |
| `.sillyspec/projects/frontend.yaml` | 前端子项目 |
| `.sillyspec/progress.json` | SillySpec 工作流进度 |
| `.sillyspec/knowledge/INDEX.md` | 知识库索引 |

## .sillyspec 目录规范

```
.sillyspec/
├── projects/          # 子项目声明（YAML）
├── changes/
│   ├── <active>/      # 活跃变更包（含 proposal, design, plan, tasks/）
│   └── archive/       # 已归档变更（13 个已完成的变更包）
├── docs/{component}/
│   ├── scan/          # 7 维扫描文档（ARCHITECTURE, PROJECT, STRUCTURE, CONVENTIONS, INTEGRATIONS, TESTING, CONCERNS）
│   └── modules/       # 模块级文档
├── knowledge/         # 项目知识库
├── quicklog/          # 快速记录
├── progress.json      # 工作流进度
└── .runtime/          # 本地运行态（gitignored）
```

每个组件（SillyHub / backend / frontend）在 `docs/` 下有独立的 `scan/` 和 `modules/` 目录，形成分层认知体系。
