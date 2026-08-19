---
id: task-10
title: Runtime dialog assembler integration
title_zh: runtimes 弹窗接入装配器 + 文案改「进度」+ 16 处断言适配
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P0
depends_on: [task-01, task-06]
blocks: [task-12]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
expects_from:
  task-01:
    - contract: applyLogToSegments
      needs: [AssembledTurn, AssemblerLogInput]
  task-06:
    - contract: TurnTimelineProps
      needs: [turns, viewMode]
goal: >
  interactive-session-panel 的 onLog 日志处理副本替换为装配器调用，
  viewMode「全部」改「进度」并适配 16 处测试断言
implementation:
  - 删除 onLog 内联日志处理副本（约 265-398 行）与 partialSegmentsRef（约 218 行及 onTurnCompleted 处 clear），改为构造归一输入调 applyLogToSegments
  - upsertTurn、终态推导与 error_detail 拉取等既有胶水保留，新 turn 初始化装配化形状并透传 turnStartedAt
  - 状态条不单独挂载，经 TurnTimeline v2 内置自动获得（Grill X-09 弹窗空间受限）
  - viewMode 切换按钮文案「全部」改「进度」（约 1087 行）
  - interactive-session-panel.test.tsx 的 16 处「全部」断言同步改「进度」（Grill X-12）
acceptance:
  - 弹窗日志处理收敛为装配器调用加少量胶水，全仓 grep 无第二实现（FR-05）
  - 运行中轮状态条在弹窗内可见，计时不归零
  - viewMode 显示「对话/进度」，16 处断言全部更新且测试全绿
verify:
  - cd frontend && pnpm test -- --run interactive-session-panel
constraints:
  - 不挂 SubagentCatalog（仅 /sessions 页，design §5 Phase3 挂载范围）
  - 测试改动仅「全部」到「进度」的文案断言，不改测试逻辑与 mock 策略
related_tests:
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx（16 处「全部」断言）
---
