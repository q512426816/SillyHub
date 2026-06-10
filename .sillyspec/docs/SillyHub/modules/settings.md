---
author: WhaleFall
created_at: 2026-06-01T12:00:00
---

# settings
> 最后更新：2026-06-10
> 最近变更：ql-20260610-004-c7f3（密码重置返回明文）
> 模块路径：backend/app/modules/settings/**

## 职责

平台设置与用户管理模块，提供系统级配置的 CRUD API 和用户管理 API（需平台管理员权限）。

- **平台设置管理**：读取和更新键值对形式的平台配置
- **用户管理**：用户列表（搜索/筛选/分页）、创建、更新、删除
- **用户详情**：会话管理、审计日志、所属 Workspace 查询
- **密码重置**：管理员一键重置，后端生成随机密码返回明文
- **权限控制**：所有端点需认证，管理操作需平台管理员权限

## 当前设计

### 文件结构

```
backend/app/modules/settings/
├── __init__.py
├── model.py       # PlatformSetting ORM 模型
├── schema.py      # Pydantic 请求/响应 schema
├── service.py     # UserService 业务逻辑（安全保护、审计）
└── router.py      # HTTP 路由定义
```

### 关键类

| 类名 | 文件 | 说明 |
|------|------|------|
| `PlatformSetting` | model.py | 平台设置表模型，含 key / value / updated_by / updated_at |
| `UserService` | service.py | 用户管理业务逻辑，含安全保护和审计 |

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
| `UserSessionRead` | schema.py | 用户会话读取响应 |
| `RevokeAllResponse` | schema.py | 批量撤销会话响应 |
| `AuditLogRead` | schema.py | 审计日志读取响应 |
| `UserWorkspaceRead` | schema.py | 用户 Workspace 角色读取响应 |
| `ResetPasswordRequest` | schema.py | 密码重置请求（new_password 可选，不传则自动生成） |
| `ResetPasswordResponse` | schema.py | 密码重置响应（含明文密码） |

### 关键函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `list_settings()` | router.py | 获取所有平台设置 |
| `update_settings()` | router.py | 批量更新平台设置 |
| `list_users()` | router.py | 获取用户列表（搜索/筛选/分页） |
| `create_user()` | router.py | 创建新用户 |
| `update_user()` | router.py | 更新用户信息（含自保护、最后管理员保护） |
| `delete_user()` | router.py | 删除用户（软删除，撤销会话） |
| `list_user_sessions()` | router.py | 获取用户活跃会话 |
| `revoke_user_session()` | router.py | 撤销单个会话 |
| `revoke_all_user_sessions()` | router.py | 撤销所有会话 |
| `list_user_audit()` | router.py | 获取用户审计日志 |
| `list_user_workspaces()` | router.py | 获取用户所属 Workspace + 角色 |
| `reset_user_password()` | router.py | 重置密码（返回明文） |

## 对外接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/settings` | 获取所有平台设置 |
| PUT | `/settings` | 批量更新平台设置 |
| GET | `/users` | 获取用户列表（支持搜索/筛选/分页/排序） |
| POST | `/users` | 创建新用户 |
| PATCH | `/users/{user_id}` | 更新用户信息 |
| DELETE | `/users/{user_id}` | 删除用户 |
| GET | `/users/{user_id}/sessions` | 获取用户活跃会话列表 |
| DELETE | `/users/{user_id}/sessions/{session_id}` | 撤销单个会话 |
| POST | `/users/{user_id}/sessions/revoke-all` | 撤销所有会话 |
| GET | `/users/{user_id}/audit` | 获取用户审计日志 |
| GET | `/users/{user_id}/workspaces` | 获取用户所属 Workspace + 角色 |
| POST | `/users/{user_id}/reset-password` | 重置密码（返回明文） |

## 设计决策

| 决策 | 原因 | 替代方案 |
|------|------|----------|
| 设置存储为键值对表 | 灵活扩展，无需 DDL 变更 | 配置文件 / 环境变量 |
| 提取 UserService | 逻辑复杂度上升，需要安全保护和审计 | 内联在 router 中 |
| 密码重置返回明文 | 管理员需告知用户新密码 | 邮件发送（暂无邮件服务） |
| 后端生成随机密码 | 避免管理员设置弱密码 | 前端生成 |
| 删除为软删除 | 审计追踪需要保留记录 | 物理删除 |

## 变更索引

- ql-20260610-004-c7f3 | 密码重置改为后端生成随机密码并返回明文，前端一键生成+展示+复制
