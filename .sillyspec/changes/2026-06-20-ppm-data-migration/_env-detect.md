---
author: qinyi
created_at: 2026-06-03T20:30:00+08:00
---

# 构建环境探测结果

## SillyHub（主项目 / monorepo）

- **类型**: monorepo（git 仓库）
- **部署**: Docker Compose（deploy/docker-compose.yml, deploy/docker-compose.dev.yml）
- **子项目**: backend, frontend

## Backend

- **语言**: Python 3.12+
- **构建系统**: hatchling
- **包管理**: uv（uv.lock 存在）
- **框架**: FastAPI + Uvicorn
- **ORM**: SQLModel + SQLAlchemy（async）+ Alembic 迁移
- **数据库**: PostgreSQL（asyncpg）+ Redis
- **代码质量**: Ruff（lint+format）, mypy（strict=false）
- **测试**: pytest + pytest-asyncio + pytest-cov + aiosqlite
- **关键依赖**: pydantic, pydantic-settings, python-jose, passlib, httpx, structlog, python-frontmatter
- **配置文件**:
  - `backend/pyproject.toml` — 项目定义 + ruff/mypy/pytest 配置
  - `backend/ruff.toml` — ruff workspace 扩展
  - `backend/alembic.ini` — Alembic 迁移配置
  - `backend/conftest.py` — pytest 共享 fixtures

## Frontend

- **语言**: TypeScript 5.5.4
- **运行时**: Node.js >=20
- **包管理**: pnpm 9.6.0
- **框架**: Next.js 14.2.5 + React 18.3.1
- **样式**: Tailwind CSS 3.4.7 + tailwindcss-animate + shadcn/ui（class-variance-authority）
- **状态管理**: Zustand 4.5
- **数据请求**: @tanstack/react-query 5.51
- **流程图**: @xyflow/react 12.10
- **测试**: Vitest 2 + @testing-library/react + jsdom
- **关键依赖**: zod, lucide-react, @uiw/react-markdown-preview
- **配置文件**:
  - `frontend/package.json` — 依赖和脚本
  - `frontend/next.config.mjs` — Next.js 配置（API 代理 rewrite）
  - `frontend/tailwind.config.ts` — Tailwind + shadcn/ui 主题
  - `frontend/vitest.config.ts` — Vitest 测试配置（jsdom）
  - `frontend/postcss.config.mjs` — PostCSS
  - `frontend/tsconfig.json` — TypeScript 配置
  - `frontend/components.json` — shadcn/ui 组件配置
