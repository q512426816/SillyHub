---
id: task-07
title: 详情页 useQuery+refetchInterval(10s) 改造 + ChangeStepTimeline 接入 + page-team-toggle.test.tsx 适配（覆盖 FR-03, D-001@v1, D-004@v1）
title_zh: 详情页轮询改造与步骤时间线接线
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-05]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx
expects_from:
  task-05: contract ChangeStepTimeline 组件（frontend/src/components/changes/detail/change-step-timeline.tsx，props 消费 ChangeRead.steps 明细与 step_progress 摘要）
goal: >
  详情页数据获取由裸 useEffect+useState 改 react-query useQuery 智能轮询（非终态 10s、终态停轮、后台暂停，D-001/D-004），
  SillySpecStepProgress 挂载点替换为 task-05 交付的 ChangeStepTimeline（latest_progress 数据源），page-team-toggle 测试同步适配。
implementation:
  - 详情数据获取改 useQuery，queryKey 含 workspaceId 与 changeId，queryFn 保持现有请求参数与错误处理语义（loading 与 loadError 行为不变）
  - refetchInterval 用函数形式，非终态返回 10000，终态返回 false；终态判定 status 为 archived 或 location 为 archive（design §5 Phase 2.4 可测试定义）
  - refetchIntervalInBackground 保持默认 false（页面不可见暂停），不自研轮询 hook（D-004@v1，react-query 既有能力）
  - 删 page.tsx:180-206 从 change.stages 派生 steps 的 IIFE 块与 StepInfo import，页面挂 ChangeStepTimeline，数据源 change.steps 与 step_progress
  - change.steps 为 null 或缺失时降级不渲染时间线区块（视觉与现状一致，D-003 降级语义）
  - 审批成功后的刷新改 query 失效重取（invalidate 或 refetch），保持现有 handleGateAction 交互语义
  - page-team-toggle.test.tsx 适配——渲染包 QueryClientProvider（retry 关闭），getChange 等 mock 不变，时间线组件按只读卡片 stub 范式处理，补时间线渲染与降级断言
acceptance:
  - 非终态详情页 10000ms 周期刷新，变更进入终态（archived 或 archive）后停轮
  - 有 steps 数据时详情页渲染 ChangeStepTimeline 区块，steps 缺失时不渲染（降级）
  - SillySpecStepProgress 挂载删除后 page-team-toggle.test.tsx 全绿
  - tsc 0 error
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx" && pnpm exec tsc --noEmit
constraints:
  - 不动后端
  - 不改时间线组件本体（task-05 交付物，本任务仅消费其 props 契约）
  - 保持页面其它区块（审批卡/执行日志/文件卡/会话卡/审核历史/任务看板）不动
---
