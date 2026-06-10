---
author: WhaleFall
created_at: 2026-06-10T10:00:00
---

# Requirements: 用户管理模块升级（第一阶段）

## 功能需求

### FR-01: Platform Admin 权限校验
- 所有 `/api/users` 端点（list/create/update/delete）必须要求 `is_platform_admin=True`
- 新增端点（sessions/audit/reset-password）同样要求 admin 权限
- 非管理员访问返回 403

### FR-02: 安全保护
- FR-02a: 不能删除自己的账号（403）
- FR-02b: 不能禁用自己的账号（403）
- FR-02c: 不能移除最后一个 platform admin（403）
- FR-02d: 禁用用户时撤销该用户所有活跃会话
- FR-02e: 删除用户时撤销该用户所有活跃会话

### FR-03: 用户列表增强
- FR-03a: 按 email/display_name 模糊搜索（q 参数）
- FR-03b: 按 status 精确筛选（active/disabled）
- FR-03c: 按 role 筛选（admin/user）
- FR-03d: 分页（limit/offset，默认 limit=20）
- FR-03e: 按 created_at/last_login_at/email 排序（默认 created_at desc）

### FR-04: 用户详情
- FR-04a: 基本信息展示（email, display_name, status, admin, created_at, last_login_at）
- FR-04b: 所属 Workspace 及角色只读列表
- FR-04c: 活跃会话列表（user_agent, ip, created_at）
- FR-04d: 审计记录（最近的用户相关操作）

### FR-05: 管理员重置密码
- FR-05a: POST /api/users/{id}/reset-password
- FR-05b: 新密码最少 8 字符
- FR-05c: 重置后撤销该用户所有会话（强制重新登录）

### FR-06: 审计日志
- FR-06a: 用户创建/更新/删除操作写入 AuditLog
- FR-06b: 密码重置操作写入 AuditLog
- FR-06c: Admin 角色变更写入 AuditLog
- FR-06d: 每条审计记录包含 actor_id、action、resource_type="user"、resource_id

## 非功能需求

### NFR-01: API 兼容性
- 现有 GET/POST/PATCH/DELETE /api/users 端点路径和响应格式不变
- 新增查询参数均为可选

### NFR-02: 性能
- 用户列表查询在 1000 用户以内响应 <200ms
- 会话撤销操作在 100 并发会话以内 <100ms

## 约束
- 不引入新数据库表（使用现有 users, sessions, audit_log, user_workspace_roles 表）
- 不引入新依赖
