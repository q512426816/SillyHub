---
author: qinyi
created_at: 2026-05-29T17:36:30
---

# ARCHITECTURE — multi-agent-platform (monorepo)

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 后端语言 | Python | 3.12+ |
| 后端框架 | FastAPI (async) | 0.115+ |
| ORM | SQLModel + SQLAlchemy 2.0 (async) | — |
| 数据库 | PostgreSQL | 16 |
| 缓存 | Redis | 7 |
| 认证 | JWT (python-jose) + bcrypt + NaCl | — |
| 迁移 | Alembic | 1.13+ |
| 前端语言 | TypeScript | 5.5.4 |
| 前端框架 | Next.js (App Router) | 14.2.5 |
| UI | React + Tailwind CSS (shadcn/ui) | 18.3.1 / 3.4.7 |
| 状态管理 | Zustand (persist) | 4.5.0 |
| 验证 | Zod | 3.23.0 |
| 拓扑可视化 | @xyflow/react | 12.10.2 |
| 后端测试 | pytest (async) | 8+ |
| 前端测试 | Vitest + Testing Library | 2+ |
| 后端 Lint | Ruff + mypy | — |
| 前端 Lint | ESLint + tsc strict | — |
| 包管理 | uv (Python) + pnpm 9.6 (Node) | — |
| CI/CD | GitHub Actions | — |
| 容器 | Docker 多阶段构建 | — |

## 架构概览

```
multi-agent-platform/
  backend/           FastAPI API 服务器（19 个模块，/api 前缀）
  frontend/          Next.js Web 应用（22 个路由，App Router）
  deploy/            Docker Compose + .env 配置
  prototype/         14 个 HTML 原型 + common.css
  docs/              设计文档、执行计划、参考资料
  spikes/            3 个技术验证（git-isolation, workspace-scan, claude-code）
  .github/           GitHub Actions CI
  .sillyspec/        SillySpec 规范驱动开发框架
  Makefile           统一命令入口（dev-up, backend-*, frontend-*, up/down）
```

### 核心数据面
- 扫描文档（scan_documents）和组件关系（workspace_relations）是平台的核心数据面
- workspace 为顶层组织单元，所有业务实体通过关联表挂载到 workspace

### 执行面
- agent、worktree、tool_gateway、git_gateway 构成执行面
- 支持 Agent 运行、Git 操作审计、工具调用审计

### 部署架构
- **全栈** (`deploy/docker-compose.yml`): postgres:16 + redis:7 + backend + frontend，4 个命名卷
- **开发** (`deploy/docker-compose.dev.yml`): 仅 postgres + redis，前后端宿主机热重载
- Backend 挂载宿主机 `.sillyspec` 目录

### CI/CD
- GitHub Actions (`backend-ci.yml`): ruff check → ruff format --check → mypy → pytest --cov-fail-under=60
- 触发: Push/PR 到 `backend/**`

## 数据模型（摘要）

参见各子项目 ARCHITECTURE.md:
- **backend**: 24+ 张表（auth, workspace, change, task, agent, workflow, release, incident 等）
- **frontend**: 无独立数据模型，90+ TypeScript 类型通过 API 层消费 backend 数据
