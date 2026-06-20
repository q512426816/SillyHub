---
id: task-10
title: 前端 pm 项目管理页面(项目/客户/成员/干系人)
priority: P1
estimated_hours: 10
depends_on: [task-09]
blocks: [task-13]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-007@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
实现 ppm 项目管理 4 子域 CRUD 页面(AntD Table + Form + Drawer),覆盖项目维护、客户、项目成员、干系人,作为后续子域的基础数据来源(project_member 被审批流/看板依赖)。

## 文件
- 新增 frontend/src/app/(dashboard)/ppm/projects/page.tsx("use client",项目维护)
- 新增 frontend/src/app/(dashboard)/ppm/customers/page.tsx(客户维护)
- 新增 frontend/src/app/(dashboard)/ppm/project-members/page.tsx(项目成员)
- 新增 frontend/src/app/(dashboard)/ppm/project-stakeholders/page.tsx(项目干系人)

## 实现要点(参照源)
- 参照源 views/ppm/{projectmaintenance,customermaintenance,projectmember,projectstakeholder}/index.vue 的列表字段、查询条件、表单项。
- 复用 task-09 的 listXxx/createXxx/updateXxx/deleteXxx + exportXxx 动词。
- UI:参照现有 frontend/src/app/(dashboard)/admin/users/page.tsx 的 Table+Drawer CRUD 模式(AntD 6 + Tailwind + shadcn 原子件);状态用 Zustand 或本地 useState。
- 成员页:关联项目下拉 + 用户选择(走 admin users simple-list);角色字段参照 D-004@v1(开发/项目/部门经理 + 成员)。
- 干系人页:关注度/影响力等枚举字段用 AntD Select。
- 导出按钮调 exportXxx,返回 blob 触发下载。
- 无 i18n,文案直接中文。

## 验收
- [ ] 4 页面可访问,列表加载 + 分页 + 排序正常
- [ ] 新增/编辑(Drawer Form)/删除弹确认,提交后表格刷新
- [ ] 查询条件(项目名/客户名/成员名等)生效
- [ ] 导出按钮产出 .xlsx 文件下载
- [ ] 成员页项目下拉 + 用户选择可用,影响 problem/kanban 基础数据
