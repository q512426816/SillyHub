---
id: task-03
title: Integrate WorkspaceSessionPicker into NewSessionForm
title_zh: NewSessionForm 接入选择器加机器联动
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P0
depends_on: [task-01]
blocks: [task-05]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-003@v1]
provides:
  - contract: NewSessionFormValues
    fields: [workspaceId]
  - contract: WorkspaceSessionPickerProps
    fields: [value, onChange, machines, disabled]
allowed_paths:
  - frontend/src/components/sessions/new-session-form.tsx
goal: >
  在 NewSessionForm 中引入 WorkspaceSessionPicker 组件新增 workspaceId state
  实现选工作区联动切机器并在提交体中透传 workspace_id
implementation:
  - 从 @/components/sessions/workspace-session-picker 导入 WorkspaceSessionPicker
  - 新增 state workspaceId: useState<string | null>(null)
  - 在表单最顶部（⓪位）渲染 WorkspaceSessionPicker 组件传入 value onChange machines disabled
  - 原有四项编号从 ①②③④ 顺移为 ②③④⑤ 同步更新 aria-label 和 section 内文案
  - handleWsChange 回调收到 (wsId boundMachineId) 时：
    若 boundMachineId 非空且命中在线机器列表则 setMachineId(boundMachineId) + setAgentId(null)
    否则机器选择不动
  - 改回「不使用工作区」时仅 setWorkspaceId(null) 不回动机器选择
  - NewSessionFormValues 接口新增 workspaceId: string | null 字段
  - handleStart 中 workspaceId 非空时 createSession 请求体加 workspace_id: workspaceId
  - 选中工作区后在选择器下方显示绿色提示条：会话将在该工作区的项目目录中运行自动加载其规范文档
acceptance:
  - 工作区选择器渲染在表单最顶部编号 ⓪
  - 选择工作区且绑定机器在线时机器选择自动切换到绑定机器
  - 选择工作区但无绑定或绑定离线时机器选择保持不动
  - 切回「不使用工作区」时仅清 workspaceId 不动机器选择
  - 提交体在 workspaceId 非空时包含 workspace_id 字段
  - 提交体在 workspaceId 为 null 时不含 workspace_id 字段（零回归 FR-04）
  - 编号顺移后所有 section 标题和 aria-label 正确更新
verify:
  - pnpm exec tsc --noEmit 无新增类型错误
  - pnpm test -- --run 无新增 fail（含既有测试适配）
constraints:
  - 不改 createSession API 函数本身（daemon.ts 已支持 workspace_id 透传）
  - 不改工作区会话页和变更中心入口（非目标）
  - 联动不强制锁定机器用户仍可手动换其它机器（D-003@v1）
related_tests:
  - path: frontend/src/components/sessions/__tests__/new-session-form.test.tsx
    reason: 既有测试含编号文案断言需同步更新（R-04）同时 task-05 将补充联动提交用例
---
