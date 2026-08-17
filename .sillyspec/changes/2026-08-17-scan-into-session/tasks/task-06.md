---
id: task-06
title: attach-session-deep-link
title_zh: 会话页深链 attach（?session= 读取 + 竞态处理 + 未命中直接加载）
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: [task-04]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/workspace-session-section.tsx
  - frontend/src/components/__tests__/workspace-session-section.test.tsx
provides: []
expects_from:
  task-04:
    - contract: AgentSessionListItem
      needs: [id]
goal: >
  会话页挂载时读取 URL 查询参数 session 实现深链 attach（覆盖 FR-04 与 D-002@v1）。
  竞态处理按 design R1：深链参数可能早于列表加载到达，未命中时不得静默 no-op，直接 getAgentSessionLogs + setActiveSessionId（不依赖列表就绪）；?session 变化时同步更新选中状态。
implementation:
  - 挂载时用 URLSearchParams 读取 session 参数，非空则触发深链 attach 流程
  - 深链未命中列表时不得静默 no-op，直接 getAgentSessionLogs 拉日志转 turns 并 setActiveSessionId，不依赖列表就绪
  - 列表命中时复用 handleSelectById 流程，ended/failed 会话先 reopenSession 再 attach
  - ?session 参数变化时同步更新选中状态，与当前 activeSessionId 不一致则重新 attach 或清除
acceptance:
  - URL 带 session 参数时页面自动 attach 该会话，面板展示对应会话内容
  - 列表未加载时序不静默 no-op，深链会话不在已加载列表中也直接拉日志并选中
  - ?session 参数变化时选中状态同步更新，新增深链用例（列表已加载/未加载两种时序）通过且既有用例零回归
verify:
  - cd frontend 后 pnpm vitest run workspace-session-section
  - cd frontend 后 pnpm exec tsc --noEmit
constraints:
  - 只修改 allowed_paths 内的 workspace-session-section.tsx 与其测试文件
  - 复用既有 handleSelectById/handleSelect 流程，不重造 attach 逻辑，竞态分支不阻塞列表异步加载
  - 深链读取与 runtime-session-helpers 的 ?session= 写入语义一致，不为通过而修改既有测试断言
related_tests: workspace-session-section.test.tsx（深链参数行为需新增用例；该组件测试 mock 了 daemon/agent lib）
---
