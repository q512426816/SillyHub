---
author: qinyi
created_at: 2026-05-30 20:20:00
---

# core

> 最后更新：2026-05-30
> 最近变更：2026-05-30-agent-adapter
> 模块路径：`app/core/**`

## 职责

横切关注点：配置、数据库、认证、Redis、错误体系、日志、安全、加密等基础设施。

## 当前设计

`core` 不是业务模块，而是所有业务模块共享的基础设施层。各子模块独立：

- `config.py`：Pydantic Settings 配置
- `db.py`：SQLAlchemy async session
- `auth_deps.py`：FastAPI 依赖注入（JWT → User）
- `redis.py`：Redis 连接池 + Pub/Sub
- `errors.py`：统一错误层次体系
- `logging.py`：structlog 配置
- `security.py`：安全工具
- `crypto.py`：加密工具

### 错误层次体系（errors.py）

```
AppError (base)
  ├── NotFound
  │     ├── WorkspaceNotFound
  │     ├── TaskNotFound
  │     ├── WorktreeNotFound
  │     ├── WorktreeLeaseNotFound
  │     ├── ChangeNotFound
  │     └── AgentRunNotFound          ← 2026-05-30 新增
  ├── Conflict
  │     └── WorktreeLeaseConflict
  ├── Forbidden
  ├── AgentRunNotRunning              ← 2026-05-30 新增
  ├── AgentRunNotKillable             ← 2026-05-30 新增
  ├── AgentRunError
  └── ValidationError
```

## 对外接口

| 接口 | 说明 | 调用方 |
|------|------|--------|
| `AppError` 子类 | 统一 HTTP 错误响应 | 所有模块 |
| `get_session()` | DB session 依赖 | router 层 |
| `get_redis()` | Redis 连接 | agent, workflow |
| `require_permission()` | 权限检查依赖 | router 层 |

## 设计决策

| 决策 | 理由 | 来源 |
|------|------|------|
| AppError 层次继承 | 统一错误格式，自动映射 HTTP status | 初始设计 |
| Pydantic Settings | 类型安全配置 + env 覆盖 | 初始设计 |

## 依赖关系

### 依赖本模块
- 所有业务模块

### 本模块依赖
- 无（最底层）

## 注意事项

- 新增业务错误应继承 `AppError` 并设置 `code` 和 `http_status`
- 错误类命名遵循 `<Entity><Condition>` 模式（如 `AgentRunNotFound`）

## 变更索引

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-05-30 | 2026-05-30-agent-adapter | 新增 AgentRunNotFound / AgentRunNotRunning / AgentRunNotKillable 错误类型 |
