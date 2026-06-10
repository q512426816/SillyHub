---
author: WhaleFall
created_at: 2026-06-10T10:00:00
---

# Proposal: 用户管理模块升级（第一阶段）

## 变更名
`2026-06-10-user-management`

## 问题陈述

当前 /settings 用户管理存在严重安全缺陷：
1. **无权限校验**：所有 `/api/users` 端点仅依赖 `get_current_user`，任何认证用户可执行全部 CRUD 操作
2. **无安全保护**：可删除自己、禁用自己、移除最后一个管理员
3. **无审计**：用户操作不写入审计日志
4. **无会话管理**：禁用/删除用户不会撤销其活跃会话
5. **前端简陋**：无搜索、无分页、无详情、无密码重置

## 目标

第一阶段聚焦安全加固 + 基础功能补全，不涉及 Workspace 角色管理、邀请流程、Git 身份绑定（留待后续阶段）。

## 范围

### 包含
- 后端权限校验（platform admin only）
- 安全保护（自操作防护、最后管理员保护、会话撤销）
- 用户列表增强（搜索、筛选、分页、排序）
- 用户详情抽屉（基本信息、会话列表、审计记录）
- 管理员重置密码
- 全部操作审计日志
- API 兼容性保留

### 不包含
- Workspace 成员角色管理（user_workspace_roles）
- 邀请用户流程
- Git 身份绑定
- MFA 实现
- OAuth/SSO
- 前端权限检查工具函数（后续）

## 影响组件

| 组件 | 改动类型 |
|------|----------|
| `backend/app/core/auth_deps.py` | 修复 `require_platform_admin()` |
| `backend/app/modules/settings/router.py` | 权限校验 + 新端点 |
| `backend/app/modules/settings/service.py` | 新建，提取用户管理业务逻辑 |
| `backend/app/modules/settings/schema.py` | 增强查询参数 + 新 DTO |
| `frontend/src/lib/settings.ts` | 增强 API 客户端 |
| `frontend/src/app/(dashboard)/settings/page.tsx` | 用户列表增强 + 详情抽屉 |

## 风险

- 密码重置接口需额外保护（审计 + 管理员二次确认）
- 会话批量撤销在高并发场景可能有性能影响
