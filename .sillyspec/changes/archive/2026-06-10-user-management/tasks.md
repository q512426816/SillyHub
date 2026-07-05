---
author: WhaleFall
created_at: 2026-06-10T10:00:00
---

# Tasks: 用户管理模块升级（第一阶段）

## Task 01: 修复 require_platform_admin + 端点权限校验
- [ ] 修复 `backend/app/core/auth_deps.py` 的 `require_platform_admin()` 检查 `is_platform_admin`
- [ ] `settings/router.py` 所有用户端点改用 `Depends(require_platform_admin)`
- [ ] 验证非管理员访问返回 403

**涉及文件**: `backend/app/core/auth_deps.py`, `backend/app/modules/settings/router.py`

## Task 02: 提取 UserService + 安全保护
- [ ] 新建 `backend/app/modules/settings/service.py`，创建 `UserService` 类
- [ ] 实现 `list_users(q, status, role, sort, order, limit, offset)` 查询增强
- [ ] 实现 `update_user(actor_id, target_id, ...)` 含自禁用保护 + 最后管理员保护
- [ ] 实现 `delete_user(actor_id, target_id)` 含自删除保护
- [ ] 禁用/删除时撤销目标用户所有活跃会话
- [ ] Router 调用改为 UserService

**涉及文件**: `backend/app/modules/settings/service.py` (新建), `backend/app/modules/settings/router.py`, `backend/app/modules/settings/schema.py`

## Task 03: 审计日志接入
- [ ] UserService 操作中设置 audit_context
- [ ] 关键操作（创建、更新、删除、密码重置、admin 变更）显式写 AuditLog
- [ ] `GET /api/users/{id}/audit` 端点

**涉及文件**: `backend/app/modules/settings/service.py`, `backend/app/modules/settings/router.py`

## Task 04: 用户详情后端端点
- [ ] `GET /api/users/{id}/sessions` — 返回活跃会话列表
- [ ] `GET /api/users/{id}/workspaces` — 返回所属 workspace + 角色
- [ ] `POST /api/users/{id}/reset-password` — 管理员重置密码

**涉及文件**: `backend/app/modules/settings/router.py`, `backend/app/modules/settings/service.py`, `backend/app/modules/settings/schema.py`

## Task 05: 前端用户列表增强
- [ ] 搜索框（email/display_name）
- [ ] Status 筛选下拉
- [ ] Role 筛选下拉（admin/user）
- [ ] 分页控件
- [ ] 排序列头点击

**涉及文件**: `frontend/src/lib/settings.ts`, `frontend/src/app/(dashboard)/settings/page.tsx`

## Task 06: 前端用户详情抽屉
- [ ] 点击用户行展开右侧 Drawer
- [ ] Tab 1: 基本信息 + 所属 Workspace 角色
- [ ] Tab 2: 活跃会话列表 + 撤销按钮
- [ ] Tab 3: 审计记录
- [ ] 管理员重置密码按钮（带确认弹窗）

**涉及文件**: `frontend/src/app/(dashboard)/settings/page.tsx`, `frontend/src/lib/settings.ts`
