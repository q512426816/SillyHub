---
author: qinyi
created_at: 2026-06-03T10:00:00
---

# PROJECT — backend

## 项目信息

- **名称**: multi-agent-platform-api
- **描述**: Multi-Agent Collaboration Platform — Backend API (FastAPI)
- **版本**: 0.1.0
- **Python**: >=3.12

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| Web 框架 | FastAPI | >=0.115 |
| ASGI 服务器 | uvicorn | >=0.30 |
| 数据校验 | Pydantic | >=2.8 |
| 配置管理 | pydantic-settings | >=2.4 |
| ORM | SQLModel + SQLAlchemy[asyncio] | >=0.0.22 / >=2.0 |
| 数据库驱动 | asyncpg | >=0.29 |
| 数据库迁移 | Alembic | >=1.13 |
| 缓存 | Redis | >=5.0 |
| 日志 | structlog | >=24.4 |
| HTTP 客户端 | httpx | >=0.27 |
| 认证 | python-jose + passlib | >=3.3 / >=1.7 |
| 构建 | hatchling | - |
| 测试 | pytest + pytest-asyncio | >=8 / >=0.23 |
| Lint | ruff | >=0.6 |
| 类型检查 | mypy | >=1.11 |

## 项目阶段

**开发中** — 版本 0.1.0，核心功能（工作区管理、Agent 执行、变更流程）已实现，认证和 RBAC 已就绪。

## 关键指标

| 指标 | 数值 |
|------|------|
| Python 源文件 | 219 |
| 业务模块 | 21 |
| 数据表 | 32 |
| API Router | 22 |
| 测试文件 | 182 |
| 模块测试覆盖率 | 86% (18/21) |
