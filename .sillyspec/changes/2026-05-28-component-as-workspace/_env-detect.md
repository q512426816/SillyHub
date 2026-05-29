---
author: qinyi
created_at: 2026-05-29T17:35:54
---

# 构建环境探测

## Monorepo 根目录

- 无根 package.json / Dockerfile / compose 文件
- Git 用户：qinyi

## Frontend（./frontend）

| 项目 | 值 |
|------|------|
| 包管理器 | pnpm 9.6.0 |
| 框架 | Next.js 14.2.5 |
| UI | React 18.3.1 + Tailwind CSS 3.4.7 (shadcn/ui 风格) |
| 语言 | TypeScript 5.5.4 (strict) |
| 测试 | Vitest 2.x + Testing Library + jsdom |
| 构建 | Dockerfile (Node 20-alpine, 三阶段, standalone) |
| 端口 | 3000 |
| 路径别名 | @ → ./src |
| 额外依赖 | @tanstack/react-query, @xyflow/react, zustand, zod, lucide-react |

### 关键配置

- `next.config.mjs`: standalone 输出（按 NEXT_BUILD_STANDALONE 环境变量），typedRoutes
- `tailwind.config.ts`: class 暗色模式, CSS 变量 HSL 颜色系统, tailwindcss-animate
- `vitest.config.ts`: jsdom 环境, 全局 API, @ 别名
- `tsconfig.json`: strict + noUncheckedIndexedAccess, bundler 模块解析

## Backend（./backend）

| 项目 | 值 |
|------|------|
| 语言 | Python 3.12+ |
| 框架 | FastAPI 0.115+ |
| ORM | SQLModel 0.0.22 + SQLAlchemy 2.0 (async) |
| 数据库 | PostgreSQL (asyncpg) |
| 缓存 | Redis 5.0+ |
| 迁移 | Alembic 1.13+ |
| 构建 | Dockerfile (Python 3.12-slim, 多阶段, uv) |
| 端口 | 8000 |
| 配置 | pydantic-settings (env/.env) |
| 测试 | pytest 8 + pytest-asyncio, aiosqlite |
| Lint | ruff (E,F,I,B,UP,N,SIM,RUF,BLE) + mypy |

### 关键配置

- `pyproject.toml`: hatchling 构建, asyncio_mode=auto, ruff line-length=100
- `app/core/config.py`: 必填 database_url + secret_key, Auth JWT 配置, Worktree 路径, Docker 路径映射
- 健康检查: GET /api/health

## 构建命令

| 子项目 | 开发 | 构建 | 测试 | Lint |
|--------|------|------|------|------|
| frontend | `pnpm dev` | `pnpm build` | `pnpm test` | `pnpm lint` / `pnpm typecheck` |
| backend | `uvicorn app.main:app --reload` | Docker build | `pytest` | `ruff check` / `mypy` |
