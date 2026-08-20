---
id: task-04
title: Write WorkspaceSessionPicker unit tests
title_zh: WorkspaceSessionPicker 组件单测
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-002@v1, D-003@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/sessions/__tests__/workspace-session-picker.test.tsx
goal: >
  为 WorkspaceSessionPicker 新建 vitest 组件单测，覆盖空态/禁用/onChange 回调含绑定机器/切换回 null
implementation:
  - 新建 frontend/src/components/sessions/__tests__/workspace-session-picker.test.tsx
  - vi.mock @/lib/workspaces（listWorkspaces）和 @/lib/workspace-binding（fetchMyBindings）
  - 测试空态：listWorkspaces 返回空 → Select 禁用 + 提示文案「你还未加入工作区」
  - 测试有数据：Select 渲染工作区选项 + 首项「不使用工作区（默认）」
  - 测试 onChange：选中工作区时回调带 (workspaceId, boundMachineId)
  - 测试切换回 null：选「不使用工作区」→ onChange(null, null)
  - 测试 disabled prop 透传：disabled=true → Select disabled
  - 测试加载失败：listWorkspaces reject → 错误提示条 + 重试按钮
acceptance:
  - 所有测试用例在 pnpm test 下通过
  - 空态分支选中后 onChange 携带 null 值
  - 有绑定机器时 onChange 第二参数为 daemon_id（非 runtime_id）
  - 工作区无绑定时 onChange 第二参数为 null
  - 加载失败显示错误条且不崩溃
verify:
  - cd frontend && pnpm test -- --run workspace-session-picker
constraints:
  - 不使用 MSW，mock 策略与现有 sessions 测试一致（vi.mock + vi.hoisted）
  - antd Select 交互用 chooseAntdOption 工具函数（与 new-session-form.test.tsx 同款）
  - QueryClientProvider 包裹（与现有 renderForm 模式一致）
---
