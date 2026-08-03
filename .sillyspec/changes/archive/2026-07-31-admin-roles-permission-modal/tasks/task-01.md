---
id: task-01
title: RoleDrawer 抽屉 → antd Modal
title_zh: 新建编辑角色抽屉改居中弹窗
author: WhaleFall
created_at: 2026-07-31T15:05:25
priority: P0
depends_on: []
blocks: [task-04]
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/roles/page.tsx
goal: >
  RoleDrawer(:441-520)右侧抽屉(fixed right-0 w-560)改为 antd Modal(居中 w-720),给
  左树右权留分栏。字段/校验/保存/只读逻辑迁移不变。
implementation:
  - :441-443 自定义遮罩 fixed inset-0 + :444 fixed right-0 抽屉 → antd <Modal open title width={720} onCancel={onClose} onOk footer>
  - 字段(Key/名称/描述 :459-492)迁移进 Modal body,逻辑不变
  - 底栏(:509-518 取消/保存)→ Modal footer(onOk=submit,onCancel=onClose,saving/disabled/canWrite 守卫不变)
  - 系统角色只读(isReadonly :448-452)提示保留
acceptance:
  - 新建/编辑打开居中 Modal(非右侧抽屉),w-720
  - 字段/校验/保存/只读行为与改前一致
verify:
  - pnpm typecheck + task-04 Modal 测试
constraints:
  - 用 antd Modal(已在 admin/roles import antd),不用自定义 fixed 抽屉
  - 字段/校验/submit 逻辑迁移不改行为
---

## 实现说明

RoleDrawer 是自定义抽屉(fixed right-0 w-560)。换 antd Modal 居中 w-720。Key/名称/描述 + 权限(picker)+ 保存逻辑全迁移进 Modal body,行为不变。Modal footer 放取消/保存。
