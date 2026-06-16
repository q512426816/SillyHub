---
author: qinyi
created_at: 2026-06-16T09:40:00
---

# Proposal — workspace-members

## 变更范围

为 SillyHub workspace 增加**成员管理 UI 和 API**，类似 GitLab/GitHub 的项目管理：

- workspace_owner / platform_admin 可在 workspace 详情页的 Members tab 中：
  - 列出当前所有成员（含 user 信息、角色、加入时间）
  - 通过 display_name / email 模糊搜索其他已注册用户
  - 添加新成员并指定角色（`workspace_owner` / `developer` / `viewer`）
  - 修改现有成员的角色（dropdown）
  - 移除成员
  - 一键"传递所有权"（把目标成员升为 owner，当前 user 自动降级为 developer）
- 复用现有 `UserWorkspaceRole` + `Permission.WORKSPACE_MEMBER_MANAGE`，无 schema 变更

## 不在范围内（显式清单）

- **不做**邀请链接 / 邮件邀请（需邮件发送基础设施）
- **不做**自定义角色（用现有 7 个 seed 角色）
- **不做** platform_admin 角色的 UI 授予/撤销（系统级保留）
- **不做**批量操作（一次一人）
- **不做**前端 vitest 单测（依赖手动 e2e；后端必须）
- **不做** workspace 创建/删除（已有路径）

## 成功标准（可验证）

- [ ] 现有用户/workspace 行为不变（注册时 seed 的 owner 关系保留）
- [ ] platform_admin 在 UI 中可看到所有 ws 的 Members tab，可加/移除/改角色
- [ ] workspace_owner 可管理自己 ws 的成员；developer/viewer 不能
- [ ] 把用户加为 developer 后，该用户访问该 ws 的 `/api/workspaces/{id}` 不再 403
- [ ] transfer-ownership 后，原 owner 变 developer，目标变 owner（事务原子性）
- [ ] 移除最后一个 owner 被后端拒绝（HTTP 400）
- [ ] 搜索结果排除已是成员的用户，只返回 `status='active'` 用户
- [ ] 端到端：用户加进 ws 后，daemon 用 admin API key 能访问该 ws 的 execution-context（不再触发 membership 403）
