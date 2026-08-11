---
id: task-03
title: ChangeStageHeader stage step bar component
title_zh: 阶段步骤条组件 ChangeStageHeader（5 大阶段宏观进度 + lastActive 展示，抽自 page.tsx）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P1
depends_on: []
blocks: [task-05, task-06]
allowed_paths:
  - frontend/src/components/changes/detail/change-stage-header.tsx
  - frontend/src/components/changes/detail/__tests__/change-stage-header.test.tsx
provides:
  - contract: ChangeStageHeader
    fields:
      - currentStage
      - stages
      - updatedAt
goal: >
  把现 page.tsx 顶部内联的 5 大阶段步骤条（需求→规划→执行→验证→归档 + 当前阶段 lastActive
  时间）原样抽成独立受控展示组件 ChangeStageHeader，逻辑零改动仅搬运；非主线三态
  （quick/blocked/archived）或非线性阶段导致 indexOf 为 -1 时返回 null 不渲染，语义与
  现页完全一致；为 task-05/task-06 提供可复用的纯展示组件并配测试。
implementation:
  - 新建 frontend/src/components/changes/detail/change-stage-header.tsx，导出 ChangeStageHeader 与 ChangeStageHeaderProps，Props 三字段 currentStage 与 stages 与 updatedAt，类型对齐 design §7（currentStage 可空 string，stages 为 Record 可空，updatedAt 可空 string 兜底）。
  - 组件内复刻现页 WORKFLOW_STAGES 顺序 brainstorm/plan/execute/verify/archive 与 WORKFLOW_STAGE_LABELS 中文标签映射（需求分析/规划/执行/验证/归档），用 indexOf 求 currentIndex，小于 0 时早返回 null（quick/blocked/archived 退化为 PageHeader 徽标，不进步骤条）。
  - 渲染圆形序号节点：已完成 bg-emerald-500 显对勾，当前 bg-primary 显序号高亮加粗，未到 bg-muted 弱化，节点间插分隔短线；标签当前 text-foreground 否则 text-muted-foreground。
  - lastActive 取 stages 中当前阶段对象的 lastActive 字段，缺失则回落 updatedAt；非空时显 当前阶段加本地化时间 toLocaleString，缺失不渲染该行。
  - 本任务对外提供纯展示组件契约 ChangeStageHeader（props currentStage/stages/updatedAt），供 task-06 编排消费；expects_from 留空（不消费其他 task 契约）。不改被抽源码语义，task-06 编排时才删 page.tsx 旧实现。
acceptance:
  - currentStage 为 execute 时步骤条渲染 5 节点且需求分析与规划显对勾，执行节点高亮，验证与归档弱化。
  - currentStage 为 quick 或 blocked 或 archived 或未知值时组件返回 null 不渲染步骤条容器。
  - stages 中当前阶段带 lastActive 时显其本地化时间，缺 lastActive 但 updatedAt 非空时回落显 updatedAt，两者皆空不显时间行。
  - cd frontend && pnpm test 下 change-stage-header.test.tsx 全绿。
verify: cd frontend && pnpm test src/components/changes/detail/__tests__/change-stage-header.test.tsx
constraints:
  - 纯展示受控组件，不引入任何数据请求或全局 store，逻辑与样式 className 照搬现 page.tsx 629-672 行，不重写不重排。
  - 沿用本页现有 @/components/ui 与 tailwind 原子类，不换组件库（D-005）；不新增对外字段或 API，无需 gen:types。
---
