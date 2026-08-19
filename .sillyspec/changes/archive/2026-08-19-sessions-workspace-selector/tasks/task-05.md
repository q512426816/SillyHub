---
id: task-05
title: NewSessionForm workspace integration tests
title_zh: NewSessionForm 联动与提交测试 + 既有断言适配
author: WhaleFall
created_at: 2026-08-19T14:31:18
priority: P1
depends_on: [task-01, task-03]
blocks: []
requirement_ids: [FR-02, FR-04, FR-06, R-04]
decision_ids: [D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/__tests__/new-session-form.test.tsx
goal: >
  补充 NewSessionForm 工作区联动/提交/零回归用例，适配编号顺移后既有断言
implementation:
  - 修改 frontend/src/components/sessions/__tests__/new-session-form.test.tsx
  - vi.mock 新增 @/lib/workspaces 和 @/lib/workspace-binding（fetchMyBindings）
  - 新增 describe「工作区选择器联动」：选工作区 → onChange 回调触发 setMachineId + setAgentId(null)
  - 新增测试「选工作区绑定在线机器 → 机器自动切换」（D-003@v1 联动规则）
  - 新增测试「选工作区无绑定/离线 → 机器不动」
  - 新增测试「改回不使用工作区 → 仅清 workspaceId 不回动机器」
  - 新增测试「提交含 workspace_id」：选中工作区后 createSession 请求体含 workspace_id 字段
  - 新增测试「不选工作区零回归」：不选时请求体不含 workspace_id 键（FR-04）
  - 新增测试「工作区提示条」：选中后顶部显示绿色 Alert 含工作区名
  - 适配既有断言：编号从 ①②③④ 顺移为 ⓪①②③④（aria-label 值变更，R-04）
  - 适配既有 onCreated 回调断言：新增 workspaceId 字段
acceptance:
  - 所有新增用例通过
  - 既有测试用例全部通过（编号断言已更新）
  - 不选工作区时请求体与改前逐字节一致（零回归）
  - onCreated 回调 values 含 workspaceId
verify:
  - cd frontend && pnpm test -- --run new-session-form
constraints:
  - 不拆分文件，在现有 new-session-form.test.tsx 末尾追加 describe 块
  - workspace 选择器交互用 chooseAntdOption 工具函数
  - 既有测试断言改动仅限 aria-label 文案值和 onCreated 参数，不改测试逻辑
---
