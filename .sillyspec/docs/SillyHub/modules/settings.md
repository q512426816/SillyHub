---
author: qinyi
created_at: 2026-06-01T12:00:00
---

# settings
> 最后更新：2026-06-01
> 最近变更：scan（初始生成）
> 模块路径：backend/app/modules/settings/**

## 职责

平台设置与用户管理模块，提供系统级配置的 CRUD API 和用户管理 API（需平台管理员权限）。

- **平台设置管理**：读取和更新键值对形式的平台配置
- **用户管理**：用户列表、创建、更新、删除（CRUD）
- **权限控制**：所有端点需认证，管理操作需平台管理员权限

## 当前设计

### 文件结构

```
backend/app/modules/settings/
├── __init__.py
├── model.py       # PlatformSetting ORM 模型
├── schema.py      # Pydantic 请求/响应 schema
└── router.py      # HTTP 路由定义
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `PlatformSetting` | model.py | 平台设置表模型，含 key / value / updated_by / updated_at |

### 关键 Schema

| 类名 | 文件 | 说明 |
|------|------|------|
| `SettingRead` | schema.py | 单条设置读取响应 |
| `SettingsBulkRead` | schema.py | 批量设置读取响应 |
| `SettingsUpdateRequest` | schema.py | 设置更新请求（key-value 列表） |
| `SettingsUpdateResponse` | schema.py | 设置更新响应 |
| `UserCreateRequest` | schema.py | 用户创建请求 |
| `UserUpdateRequest` | schema.py | 用户更新请求 |
| `UserListResponse` | schema.py | 用户列表响应 |
| `UserRead` | schema.py | 用户读取响应 |

### 关键函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `list_settings()` | router.py | 获取所有平台设置 |
| `update_settings()` | router.py | 批量更新平台设置 |
| `list_users()` | router.py | 获取用户列表（分页） |
| `create_user()` | router.py | 创建新用户 |
| `update_user()` | router.py | 更新用户信息 |
| `delete_user()` | router.py | 删除用户 |

## 对外接口

| 函数名 | 方法 | 路径 | 说明 |
|--------|------|------|------|
| `list_settings` | GET | `/settings` | 获取所有平台设置 |
| `update_settings` | PUT | `/settings` | 批量更新平台设置 |
| `list_users` | GET | `/users` | 获取用户列表（支持分页） |
| `create_user` | POST | `/users` | 创建新用户 |
| `update_user` | PATCH | `/users/{user_id}` | 更新用户信息 |
| `delete_user` | DELETE | `/users/{user_id}` | 删除用户 |

## 关键数据流

1. **设置读取流**：GET /settings → 查询 PlatformSetting 表 → SettingsBulkRead
2. **设置更新流**：PUT /settings → 校验权限 → 遍历 key-value 列表 → upsert 到 PlatformSetting 表 → SettingsUpdateResponse
3. **用户创建流**：POST /users → 校验权限 → 密码哈希 → 插入 User 记录 → UserRead
4. **用户列表流**：GET /users → 校验权限 → 分页查询 User 表 → UserListResponse

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| 设置存储为键值对表 | 灵活扩展，无需 DDL 变更 | 配置文件 / 环境变量 |
| 用户管理与设置合并为同一模块 | 都是平台管理功能，权限相同 | 独立 users 模块 |
| 无独立 service 层 | 当前逻辑简单，直接在 router 中处理 | 抽取 service 层 |
| 分页查询用户列表 | 用户量可能较大 | 一次性返回全部 |

## 依赖关系

### 内部依赖
- `app.models.base` — BaseModel
- `app.modules.auth.model` — User（复用用户模型）
- `app.core.auth_deps` — get_current_user（认证）
- `app.core.db` — get_session
- `app.core.logging` — get_logger
- `app.core.security` — password_hasher（创建用户时哈希密码）

### 外部库
- fastapi — APIRouter, Depends, HTTPException, Query
- sqlalchemy (async) — 异步查询、func.count
- sqlmodel — col() 排序
- pydantic — Schema 定义

## 注意事项

- 所有端点均需认证（get_current_user 依赖）
- 设置更新使用 upsert 逻辑（存在则更新，不存在则创建）
- 用户创建时密码通过 `password_hasher.hash()` 加密存储
- 删除用户为物理删除（非软删除），需谨慎
- 用户列表支持分页参数

## 变更索引

| 日期 | 变更 | 影响 |
|------|------|------|
| | | |
