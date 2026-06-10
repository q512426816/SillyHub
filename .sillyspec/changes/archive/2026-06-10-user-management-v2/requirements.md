---
author: WhaleFall
created_at: 2026-06-10T12:30:00
---

# Requirements: 用户管理模块升级 v2

## 角色

| 角色 | 说明 |
|------|------|
| Platform Admin | 执行用户管理操作的唯一角色 |

## 功能需求

### FR-01: 单个会话撤销
Given 用户有活跃会话
When Platform Admin 调用 DELETE /api/users/{id}/sessions/{session_id}
Then 该会话被标记为 revoked，写入审计日志

Given 会话不属于目标用户或已撤销
When 调用 DELETE /api/users/{id}/sessions/{session_id}
Then 返回 404

### FR-02: 批量撤销会话
Given 用户有 N 个活跃会话
When Platform Admin 调用 POST /api/users/{id}/sessions/revoke-all
Then 所有活跃会话被撤销，返回 revoked_count，写入审计日志

### FR-03: 密码重置审计标记
Given Platform Admin 重置用户密码
When 传入 force_change_on_next_login=true
Then 审计日志 details_json 包含 force_change_on_next_login=true 标记

Given 传入 force_change_on_next_login=false 或不传
When 重置密码
Then details_json 中 force_change_on_next_login 为 false 或不存在

### FR-04: 用户 Workspace 角色查询
Given 用户属于 Workspace A (role: developer) 和 Workspace B (role: reviewer)
When Platform Admin 调用 GET /api/users/{id}/workspaces
Then 返回 [{workspace_name: "A", workspace_slug: "a", role_name: "developer"}, ...]

Given 用户不属于任何 Workspace
When 调用 GET /api/users/{id}/workspaces
Then 返回空数组

### FR-05: 前端操作列优化
Given 用户列表展示
When 管理员查看操作列
Then 只看到"详情"链接，点击打开 Drawer

### FR-06: Drawer 增强
Given 用户详情 Drawer 打开
When 查看"所属 Workspace" Tab
Then 显示 workspace name + role name 列表

Given 会话 Tab 展示
When 管理员点击某个会话的"撤销"按钮
Then 该会话被撤销

Given 会话 Tab 展示
When 管理员点击"撤销全部会话"
Then 所有活跃会话被撤销

## 非功能需求

- 兼容性：现有 API 端点路径和响应格式不变
- 审计：所有新增管理操作写入 AuditLog
