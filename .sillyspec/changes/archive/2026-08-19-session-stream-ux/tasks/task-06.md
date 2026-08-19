---
id: task-06
title: TurnTimeline v2 segment-based rendering
title_zh: TurnTimeline v2 段模型渲染重构
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P0
depends_on: [task-05, task-07]
blocks: [task-09, task-10, task-12]
requirement_ids: [FR-01, FR-02, FR-06]
decision_ids: [D-001@v1]
expects_from:
  task-01:
    - contract: TurnSegment
      needs: [kind, id]
  task-05:
    - contract: SegmentViewProps
      needs: [segment]
  task-07:
    - contract: TurnStatusBar
      needs: [turnStartedAt]
provides:
  - contract: SessionTurnView
    fields: [segments, turnStartedAt, output, processItems]
  - contract: TurnTimelineProps
    fields: [turns, viewMode]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
goal: >
  依 design §5 Phase2 与 §7 SessionTurnView 扩展重构 turn-timeline.tsx 渲染层为 v2：
  消费 segments 段序列分段渲染、视图两态语义更新、内置 TurnStatusBar，
  segments 缺省回退旧渲染路径保持对外兼容。
implementation:
  - SessionTurnView 增可选 segments（TurnSegment[]）与 turnStartedAt 字段，output/processItems 保留为兼容投影（§9.4）
  - 有 segments 的 turn 轮内渲染替换为 turn-segment-views 段组件族（文本/思考/工具/子代理/stderr），稳定段 id 作 key
  - 视图两态重定义：conversation = 文本段 + 运行中状态条 + 轻量 AskUser 记录；all = 完整段时间线（展示语义改「进度」，类型取值不变，按钮文案改动属 task-09/10）
  - 运行中轮头部内显 TurnStatusBar（Grill X-09，两消费方自动获得）；AskUser 穿插保持（all 视图按 run_id + 时间戳合并排序穿插，conversation 保留 ❓ 轻量记录）
  - segments 为 undefined 的 turn（孤儿 turn 构造路径）走旧渲染回退，TurnDetailsList/ToolEventCard/SessionCollapsible 保留不删；whoLine/sender/errorDetail/孤儿 turn 紧凑标记/TurnStatusBadge 行为不变
acceptance:
  - 有 segments 的 turn 按 kind 有序分段渲染，文本不再粘连为一整条（FR-01）
  - conversation 视图运行中轮显示状态条，turn 终态后消失（FR-02）
  - all 视图渲染完整段时间线，AskUser 按时间戳穿插在对应位置
  - segments 缺省的 turn 渲染与现状等价，回退不崩不空（§9.3）
  - 段级 memo + 稳定 key，流式 delta 更新不扩散到其它段（FR-06）
verify:
  - cd frontend && pnpm exec tsc --noEmit 无新增类型错误且 pnpm test -- --run 全绿（含直测断言适配）
constraints:
  - 不改 sessions/page.tsx 与 interactive-session-panel.tsx（消费方接入属 task-09/10）
  - 旧渲染函数保留作回退（过渡期双路径）；SessionViewMode 取值不变（conversation/all）
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-timeline-session-input-bar.test.tsx
    reason: 唯一直测 TurnTimeline 的既有测试（__tests__ 目录 grep 实证仅此文件 import turn-timeline）；viewMode=all 过程项断言（「思考过程」折叠标题/工具 raw）与「正在思考…」占位断言在段模型下改由段组件与状态条渲染，需按段模型适配
---
