---
id: task-01
title: Create WorkspaceSessionPicker Component
title_zh: 新建 WorkspaceSessionPicker 选择器组件
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-004@v1, D-002@v1]
provides:
  - contract: WorkspaceSessionPickerProps
    fields: [value, onChange, machines, disabled]
  - contract: WorkspaceSessionPickerProps.onChange signature
    fields: [workspaceId, boundMachineId]
allowed_paths:
  - frontend/src/components/sessions/workspace-session-picker.tsx
goal: >
  新建自治受控组件 workspace-session-picker.tsx，用 antd Select 列出用户有权限的工作区
  首项「不使用工作区（默认）」选中时通过 onChange 回调同时带出绑定 daemon 实体 ID
implementation:
  - 新建文件 frontend/src/components/sessions/workspace-session-picker.tsx
  - 从 @/lib/workspaces 导入 listWorkspaces 查询工作区列表（limit=100）
  - 从 @/lib/workspace-binding 导入 fetchMyBindings 批量拉取成员绑定映射
  - 定义 WorkspaceSessionPickerProps（value / onChange / disabled）并导出
  - antd Select 首项 label「不使用工作区（默认）」value=null 其余按工作区 name 列出
  - onChange 时从 bindingsMap 按 workspaceId 查 boundMachineId 一并回调
  - 空列表态禁用 + 提示文案「你还未加入工作区 可在工作区页创建」
  - 加载失败显示错误条 + 重新加载按钮
  - machines prop 为 DaemonMachineRead[] 用于校验绑定机器是否在线
acceptance:
  - 组件渲染后首项显示「不使用工作区（默认）」且 value 为 null
  - 选中某工作区后 onChange 回调参数第一个为 workspaceId 第二个为绑定 machineId 或 null
  - 用户未加入任何工作区时 Select 禁用并显示引导提示
  - 加载失败时显示错误提示和重新加载按钮
  - disabled=true 时整个 Select 禁用
verify:
  - pnpm exec tsc --noEmit 无新增类型错误
  - 组件文件无 lint error
constraints:
  - 组件自治不依赖父层状态（受控组件仅消费 value + 回调 onChange）
  - 工作区列表上限 100 个不做搜索式下拉（R-03 已知限制）
  - fetchMyBindings 失败降级空数组不阻塞选择器渲染（既有一致行为）
related_tests:
  - path: frontend/src/components/sessions/workspace-session-picker.test.tsx
    reason: task-04 将新建该测试文件覆盖本组件空态禁用 onChange 等场景
---
