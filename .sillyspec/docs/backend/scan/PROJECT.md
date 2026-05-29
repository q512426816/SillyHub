---
author: qinyi
created_at: 2026-05-29T17:42:00
---

# PROJECT — backend

## 项目信息

- **名称**：multi-agent-platform-api
- **描述**：Multi-Agent Collaboration Platform — Backend API
- **语言**：Python 3.12+
- **框架**：FastAPI (async)
- **包管理**：uv (hatchling build)
- **入口**：`app/main.py` → `create_app()` → uvicorn
- **端口**：8000
- **健康检查**：`GET /api/health`

## 技术栈

| 维度 | 技术 |
|------|------|
| Web 框架 | FastAPI 0.115+ |
| ORM | SQLModel + SQLAlchemy 2.0 async |
| 数据库 | PostgreSQL 16 (asyncpg) |
| 缓存 | Redis 7 (async) |
| 迁移 | Alembic 1.13+ |
| 认证 | JWT + bcrypt + NaCl |
| 日志 | structlog |
| 测试 | pytest + pytest-asyncio + aiosqlite |
| Lint | Ruff + mypy |

## 模块概览

19 个业务模块，每个遵循 feature-slice 结构（model + schema + service + router）。核心横切关注点在 `app/core/`。

## 验证命令

```bash
make backend-run       # uvicorn --reload (port 8000)
make backend-test      # pytest --cov
make backend-lint      # ruff + mypy
make backend-migrate   # alembic upgrade head
```
