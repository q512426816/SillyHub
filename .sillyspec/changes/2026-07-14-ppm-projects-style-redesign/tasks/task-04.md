---
id: task-04
title: `PpmProjectMembersTable` 浮层换 antd + 角色 Badge + toast 语义化
title_zh: 成员表浮层换 antd/角色 Badge/toast 语义化
author: WhaleFall
created_at: 2026-07-14 11:00:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-03, FR-04]
decision_ids: [D-002@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/ppm-project-members-table.tsx
goal: >
  成员表 MemberFormDrawer 换 antd Drawer、DeleteMemberConfirm 换 antd Modal（maskClosable=false），角色多 Tag 换 Badge/token 色，toast 语义化。
implementation:
  - MemberFormDrawer：移除 fixed inset-0 bg-black/30 遮罩 + fixed 右抽屉 + ✕ emoji，整体替换为 antd `<Drawer open onClose width={520} maskClosable={false}>`，标题用 `新增成员/编辑成员`，表单 body + 底部取消/保存按钮内嵌 Drawer 内。
  - DeleteMemberConfirm：手写居中浮层换 antd `<Modal open onCancel onOk maskClosable={false} title="确认删除成员？">`，确认按钮走 onOk。
  - 角色列：`Tag color="blue"` 多个改 `Badge`（status="default/processing"）或 Tag + token 色，消除预设 blue。
  - toast：`border-emerald-300/bg-emerald-50/text-emerald-700` 硬编码换语义变量（border-emerald/500、bg-emerald/50 之类 token 色或 destructive 语义），保持 ok/error 两态。
acceptance:
  - MemberFormDrawer / DeleteMemberConfirm 均为 antd Drawer / Modal，点遮罩不关（maskClosable=false），ESC/✕/取消可关
  - ppm 范围 grep 不到本组件的 `bg-black/30`、`✕` emoji、`emerald-300`
  - 本组件被 projects 成员管理抽屉（外层 antd Drawer）内嵌时，内层 Drawer/Modal 层级正常：内层 z-index 自动叠加高于外层，ESC 关最上层，遮罩不穿透（R-06）
  - 角色多 Tag 改 Badge/token 色，不再用预设 `color="blue"`
  - toast ok/error 两态语义化，无硬编码 emerald 色
  - PpmUserSelect 联动回填逻辑（handleUserChange/handleRoleChange）与 CRUD 提交流程不变，纯样式
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 本组件被 projects 成员抽屉（外层 Drawer）内嵌，内层浮层 z-index 须高于外层（R-06）
  - 纯样式，PpmUserSelect 联动回填逻辑不变
---
