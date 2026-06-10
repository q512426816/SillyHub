---
author: WhaleFall
created_at: 2026-06-10T12:30:00
---

# Tasks: 用户管理模块升级 v2

## Task 01: 单个会话撤销 + 批量撤销端点
- [ ] UserService 新增 revoke_session / revoke_all_sessions
- [ ] Router 新增 DELETE /sessions/{session_id} + POST /sessions/revoke-all
- [ ] 审计日志

**涉及文件**: `backend/app/modules/settings/service.py`, `backend/app/modules/settings/router.py`

## Task 02: 密码重置审计标记增强
- [ ] 扩展 ResetPasswordRequest DTO
- [ ] reset_password 方法接受 force_change_on_next_login
- [ ] 写入审计日志 details_json

**涉及文件**: `backend/app/modules/settings/service.py`, `backend/app/modules/settings/schema.py`

## Task 03: 用户 Workspace 角色查询
- [ ] UserService 新增 list_workspaces
- [ ] Router 新增 GET /users/{id}/workspaces
- [ ] 新增 UserWorkspaceRead DTO

**涉及文件**: `backend/app/modules/settings/service.py`, `backend/app/modules/settings/router.py`, `backend/app/modules/settings/schema.py`

## Task 04: 前端 API 客户端 + 操作列简化
- [ ] settings.ts 新增 revokeSession / revokeAllSessions / listUserWorkspaces
- [ ] 操作列改为"详情"链接

**涉及文件**: `frontend/src/lib/settings.ts`, `frontend/src/app/(dashboard)/settings/page.tsx`

## Task 05: Drawer 增强（Workspace Tab + 会话撤销 + 密码增强）
- [ ] 新增"所属 Workspace" Tab
- [ ] 会话 Tab 增加撤销按钮（单个 + 全部）
- [ ] 密码重置增加 force_change_on_next_login 复选框

**涉及文件**: `frontend/src/app/(dashboard)/settings/page.tsx`
