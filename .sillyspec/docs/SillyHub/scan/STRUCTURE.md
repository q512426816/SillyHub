---
author: qinyi
created_at: 2026-05-31T23:30:00
---

# 仓库结构

> 最后更新：2026-05-31
> 范围：SillyHub monorepo 顶层目录与文件组织

## 1. 顶层目录树

```text
SillyHub/                                    # GitHub: multi-agent-platform
├── backend/                                 # FastAPI 后端子项目
│   ├── app/
│   │   ├── core/                            # 核心基础设施
│   │   │   ├── config.py                    # 环境变量 / Pydantic Settings
│   │   │   ├── db.py                        # SQLAlchemy async session
│   │   │   ├── redis.py                     # Redis 连接
│   │   │   ├── security.py                  # JWT / 密码哈希
│   │   │   ├── crypto.py                    # libsodium 凭据加密
│   │   │   ├── errors.py                    # 统一错误体系
│   │   │   ├── logging.py                   # 结构化日志
│   │   │   ├── telemetry.py                 # OpenTelemetry
│   │   │   └── audit_hooks.py               # 审计钩子
│   │   ├── models/                          # SQLModel 基类
│   │   ├── modules/                         # 垂直切片业务模块 (20+)
│   │   │   ├── agent/                       # Agent 调度
│   │   │   ├── auth/                        # 认证 + RBAC
│   │   │   ├── change/                      # 变更管理
│   │   │   ├── change_writer/               # 变更文档生成
│   │   │   ├── git_gateway/                 # Git 操作审计
│   │   │   ├── git_identity/                # Git 身份管理
│   │   │   ├── workspace/                   # 工作空间
│   │   │   ├── worktree/                    # Worktree 隔离
│   │   │   ├── workflow/                    # 变更工作流 FSM
│   │   │   ├── task/                        # 任务管理
│   │   │   ├── archive/                     # 归档
│   │   │   ├── knowledge/                   # 知识库
│   │   │   ├── tool_gateway/                # 工具网关
│   │   │   ├── scan_docs/                   # 扫描文档
│   │   │   ├── settings/                    # 系统设置
│   │   │   ├── health/                      # 健康探针
│   │   │   └── ...                          # incident/release/runtime 等
│   │   └── main.py                          # FastAPI 入口
│   ├── tests/                               # 集成测试
│   ├── alembic/                             # 数据库迁移
│   ├── Dockerfile                           # 后端容器构建
│   ├── pyproject.toml                       # uv 依赖声明
│   └── CLAUDE.md                            # Claude Code 指令
│
├── frontend/                                # Next.js 前端子项目
│   ├── src/
│   │   ├── app/                             # App Router 路由
│   │   │   ├── (dashboard)/                 # 仪表盘路由组（需登录）
│   │   │   │   ├── workspaces/[id]/         # 工作空间详情
│   │   │   │   │   ├── changes/             # 变更列表/详情
│   │   │   │   │   ├── agent/               # Agent 状态
│   │   │   │   │   └── knowledge/           # 知识库
│   │   │   │   └── layout.tsx               # 仪表盘布局
│   │   │   └── layout.tsx / page.tsx        # 根布局/首页
│   │   ├── components/                      # 组件 (ui/ + 业务组件)
│   │   ├── lib/                             # API 客户端 & 工具函数
│   │   ├── stores/                          # Zustand 状态管理
│   │   └── test/                            # 测试配置
│   ├── Dockerfile / package.json            # 构建 & 依赖
│   └── CLAUDE.md
│
├── deploy/                                  # 部署配置
│   ├── docker-compose.yml                   # 全栈 4 服务编排
│   ├── docker-compose.dev.yml               # 仅 PG + Redis
│   ├── .env.example                         # 环境变量模板
│   └── .env                                 # 实际变量（gitignored）
│
├── .sillyspec/                              # SillySpec 工作区
│   ├── projects/                            # 项目组配置 (backend.yaml / frontend.yaml)
│   ├── changes/change/                      # 活跃变更包
│   ├── changes/archive/                     # 已归档变更 (10+)
│   ├── docs/                                # 扫描文档
│   │   ├── SillyHub/scan/                   # 顶层 7 个扫描文档
│   │   ├── SillyHub/modules/                # 顶层模块文档
│   │   ├── backend/                         # 后端文档
│   │   └── frontend/                        # 前端文档
│   ├── knowledge/                           # 知识库
│   ├── quicklog/                            # 快速日志
│   └── .runtime/                            # 本地运行态（gitignored）
│
├── .github/workflows/                       # CI (backend-ci / frontend-ci)
├── spikes/                                  # V0 风险验证 (3/3 PASS)
├── Makefile                                 # 顶层命令入口
├── CLAUDE.md / README.md                    # 项目说明
├── .editorconfig / .gitignore               # 编辑器 & Git 配置
└── gate-status.json                         # 变更门禁状态
```

## 2. 子项目说明

| 属性 | backend | frontend |
|------|---------|----------|
| 路径 | `./backend` | `./frontend` |
| 运行时 | Python 3.12 + uvicorn | Node.js 20 + Next.js 14 |
| 包管理 | uv (pyproject.toml) | pnpm 9 (package.json) |
| 数据层 | PostgreSQL 16 (asyncpg) + Redis 7 | 无直接数据层 |
| ORM | SQLModel + Alembic | — |
| UI | — | shadcn/ui + Tailwind CSS |
| 状态 | — | Zustand + TanStack Query |
| 模块数 | 20+ 垂直切片 | 路由组 + 组件 + lib |
| 入口 | `app/main.py` | `src/app/layout.tsx` |

## 3. 配置文件索引

| 文件 | 用途 |
|------|------|
| `Makefile` | dev/test/lint/deploy 快捷命令 |
| `.editorconfig` | 编辑器统一（2 空格、Python 4 空格、LF） |
| `.gitignore` | Python/Node/Docker/SillySpec 忽略 |
| `deploy/.env.example` | 环境变量模板（含 Claude Code 配置） |
| `deploy/docker-compose.yml` | 全栈编排 |
| `deploy/docker-compose.dev.yml` | 开发依赖 |
| `.github/workflows/backend-ci.yml` | 后端 CI |
| `.github/workflows/frontend-ci.yml` | 前端 CI |
| `CLAUDE.md` | Claude Code 任务指令 |
| `gate-status.json` | 变更门禁状态 |

## 4. .sillyspec 目录规范

```
.sillyspec/
├── projects/          # 子项目声明（YAML）
├── changes/
│   ├── change/        # 活跃变更包
│   └── archive/       # 已完成变更
├── docs/{component}/
│   ├── scan/          # 7 维扫描文档
│   └── modules/       # 模块级文档
├── knowledge/         # 项目知识库
├── quicklog/          # 快速记录
├── progress.json      # 工作流进度
└── .runtime/          # 本地运行态（不提交）
```

每个组件（SillyHub / backend / frontend）在 `docs/` 下有独立的 `scan/` 和 `modules/` 目录，形成分层认知体系。
