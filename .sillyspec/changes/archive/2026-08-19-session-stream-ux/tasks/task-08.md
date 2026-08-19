---
id: task-08
title: Subagent catalog with jump-to locate
title_zh: 子代理目录与定位跳转
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P1
depends_on: [task-05, task-06, task-07]
blocks: [task-09]
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
expects_from:
  task-06:
    - contract: SessionTurnView
      needs: [segments]
  task-07:
    - contract: TurnActivitySummary
      needs: [subagents]
provides:
  - contract: SubagentCatalog
    fields: [turns, onJumpTo]
allowed_paths:
  - frontend/src/components/sessions/subagent-catalog.tsx
goal: >
  依 design §5 Phase3 与 FR-04 新建子代理目录组件：
  运行脉冲计数按钮 + 下拉清单 + 点击切进度视图并滚动定位展开对应子代理块。
implementation:
  - 新建组件导出 SubagentCatalog，props 为 turns 与 onJumpTo
  - 从 turns 取当前运行中（缺则最新）turn 的 segments 经 deriveTurnActivity 派生子代理清单
  - 按钮态：有运行中子代理显示脉冲点 + 运行中数，无运行显示总数
  - 下拉行如实显示状态点（running 脉冲/done/deny）+ 名称（Task description）+ subagent_type + 时长；运行中时长 = startedAt 锚点 + 每秒 tick 补足；不显示 token（无数据不编造）
  - 点击行触发 onJumpTo(segmentId) 由父层切进度视图，组件内滚动定位对应子代理块（scrollIntoView 平滑居中 + 稳定段 id 锚点）并展开该块（原型 jumpTo 交互）
  - 下拉开合：按钮 toggle 切换 + 点击外部收起
acceptance:
  - 运行中有子代理时按钮显示脉冲点与运行中数，无运行显示总数
  - 下拉每行显示状态/名称/类型/时长，运行中时长每秒跳动
  - 目录不显示 token（数据不存在不编造）
  - 点击行触发 onJumpTo 并定位展开对应子代理块
  - 子代理清单为空时不崩（空态）
verify:
  - cd frontend && pnpm exec tsc --noEmit 无新增类型错误且 pnpm test -- --run 无新增 fail
constraints:
  - 组件只消费派生数据不解析日志（装配属 task-01，派生属 task-07）
  - 仅 /sessions 页挂载（Grill X-09），挂载接线属 task-09，runtimes 弹窗不挂
  - 视觉基准为原型 subagent-catalog-btn 与 subagent-catalog-popover 样式
related_tests:
  - path: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx
    reason: 新组件无既有直测；目录挂载与跳转联动在 task-09 接入后经此文件集成覆盖，段级断言由 task-12 补
---
