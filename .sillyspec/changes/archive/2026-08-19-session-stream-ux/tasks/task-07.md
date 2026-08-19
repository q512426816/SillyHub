---
id: task-07
title: Turn Status Bar
title_zh: 轮级状态条（turn-status-bar）
author: WhaleFall
created_at: 2026-08-19T18:43:32
priority: P1
depends_on: [task-01]
blocks: [task-06, task-08]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-status-bar.tsx
provides:
  - contract: TurnActivitySummary
    fields: [toolCount, subagents, currentActivity]
  - contract: TurnStatusBar
    fields: [turnStartedAt]
expects_from:
  task-01:
    - contract: TurnSegment
      needs: [kind, id, status, startedAt, endedAt, children]
goal: 新建 turn-status-bar 导出 deriveTurnActivity 纯函数与 TurnStatusBar 组件，从 segments 派生工具计数/子代理清单/当前活动，计时锚点三源策略加每秒 tick
implementation:
  - deriveTurnActivity 纯函数 toolCount 为 tool 段总数含 children 递归 subagents 清单取有 children 归属的 tool 段 字段含 segmentId/名称取主参数摘要/status 按 endedAt 推导/起止时间/latestActivity 取内部最新 running 段摘要
  - currentActivity 取全 turn 最新 running 段摘要 无 running 工具段回退最新 streaming 段派生「正在输出文本/思考」
  - TurnStatusBar 组件 spinner 加计时 mm:ss 加工具计数加运行中子代理计数加当前活动截断省略 布局对齐原型 turn-status-bar 样式
  - 计时锚点仅消费 props 传入的 turnStartedAt 数值 live 本地占位/attach 取 run 快照 started_at/缺则首条 log timestamp 由消费方 task-09 接线
  - 每秒 tick 用 useEffect setInterval 仅运行中轮激活并卸载清理 tick 状态局部化不外溢整轮重渲染 锚点 null 容错 前 15 秒保持简洁不显秒数
acceptance:
  - 递归计数正确 嵌套子代理内部工具计入 toolCount 子代理清单字段如实不编造
  - 无 running 工具段时当前活动回退「正在输出文本/思考」 attach 传入 started_at 锚点计时从中断处恢复不归零
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 不改 turn-timeline.tsx TurnStatusBar 由 task-06 内置 TurnTimeline v2 组装 deriveTurnActivity 保持纯函数无 React 依赖亦供 task-08 目录消费
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
    reason: task-12 将新建 含状态条派生与计时用例
---
