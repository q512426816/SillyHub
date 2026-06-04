---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# health
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/health/**

## 职责

系统健康检查与版本信息模块，提供 /health 和 /version 端点，用于监控和运维。

- **健康检查**：检测 DB 和 Redis 连接状态
- **版本信息**：返回应用版本号和 commit SHA

## 当前设计

### 文件结构

```
backend/app/modules/health/
├── __init__.py    # 导出 health_router
├── schema.py      # Pydantic 响应 schema
└── router.py      # HTTP 路由定义
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `HealthResponse` | schema.py | 健康检查响应，含 status / dependencies（db/redis 状态） / checked_at |
| `VersionResponse` | schema.py | 版本响应，含 version / commit_sha |

### 关键函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `_check_db()` | router.py | 执行 `SELECT 1` 检测 DB 连接 |
| `_check_redis()` | router.py | 执行 `PING` 检测 Redis 连接 |
| `health()` | router.py | /health 端点处理函数 |
| `version()` | router.py | /version 端点处理函数 |

## 对外接口

| 函数名 | 方法 | 路径 | 说明 |
|--------|------|------|------|
| `health` | GET | `/health` | 健康检查，返回 DB/Redis 状态 |
| `version` | GET | `/version` | 版本信息，返回版本号和 commit SHA |

## 关键数据流

1. **健康检查流**：GET /health → 并发检查 DB（SELECT 1）和 Redis（PING） → 汇总状态 → HealthResponse
2. **版本查询流**：GET /version → 读取 `app.__version__` 和 Settings.commit_sha → VersionResponse

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| 独立 health 模块 | 关注点分离，不依赖认证 | 嵌入 main.py |
| DB SELECT 1 + Redis PING | 最轻量的连接检测 | 复杂的健康探测 |
| 无认证保护 | 运维探针需无认证访问 | 需认证的健康端点 |

## 依赖关系

### 内部依赖
- `app.__version__` — 应用版本号
- `app.core.config` — get_settings（获取 commit_sha）
- `app.core.db` — get_session_factory（获取 DB session）
- `app.core.logging` — get_logger
- `app.core.redis` — get_redis（获取 Redis 实例）

### 外部库
- fastapi — APIRouter
- sqlalchemy — text()（执行原生 SQL）
- pydantic — Schema 定义

## 注意事项

- /health 和 /version 均无需认证，应确保不暴露敏感信息
- `_check_db()` 和 `_check_redis()` 为内部函数，各自捕获异常并返回 degraded 状态
- 健康检查不应有超时过长的操作，避免影响监控系统

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| | | |
