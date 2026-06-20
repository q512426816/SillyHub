---
id: task-13
title: 菜单权限登记 + 端到端集成验证
priority: P0
estimated_hours: 6
depends_on: [task-09, task-10, task-11, task-12]
blocks: []
requirement_ids: []
decision_ids: [D-005@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
在 menu-permissions.ts 登记 PPM 菜单与权限映射(单一数据源,驱动菜单显隐与 AdminRolePermissionPicker),并完成 ppm 全模块端到端集成验证(登录→菜单显隐→各子域访问→CRUD→状态流转→看板拖拽)。

## 文件
- 修改 frontend/src/lib/menu-permissions.ts(新增 PPM MenuSection 或复用现有 section + 13 个 ppm 子菜单的 MenuPermissionGroup,permissions 映射 task-02 规划的 PPM_* 权限前缀)
- (可选)若需新增 section,同步 nav 渲染逻辑与 AdminRolePermissionPicker 分组

## 实现要点(参照源)
- 参照现有 frontend/src/lib/menu-permissions.ts 的 MenuPermissionGroup 结构(section/menuKey/menuLabel/icon/href/permissions),为 ppm 各子域页面登记条目:
  projects / customers / project-members / project-stakeholders / plan-nodes / project-plans / milestone-details / problem-list / problem-changes / task-plans / work-hours / work-hour-statistics / kanban。
- permissions 对应后端 Permission 枚举的 PPM_* 值(task-02 产出),格式 `{ key: "ppm:project:read", name: "..." }`;任一命中即可见。
- href 用绝对路径 `/ppm/...`(平台级,不拼 workspace 前缀,absolute: true)。
- matchPattern 按 NavItem 语义配置高亮。
- 集成验证清单覆盖 plan §全局验收标准中前端相关项 + D-005@v1 菜单显隐。

## 验收
- [ ] menu-permissions.ts 含全部 ppm 子菜单条目,类型检查通过
- [ ] 不同权限角色登录后,左侧菜单按 PPM_* 权限正确显隐
- [ ] AdminRolePermissionPicker 可为 ppm 子菜单独立分配权限
- [ ] e2e:登录 → 菜单 → 各子域页面访问 → CRUD → 里程碑状态流转 → 问题审批流 → 看板拖拽持久化 全部走通
- [ ] 无 PPM 权限用户访问 /ppm/* 返回 403 / 跳转无权限页
- [ ] 现有 auth/admin/workspace 菜单不受影响(回归)
