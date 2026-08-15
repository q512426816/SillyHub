---
id: task-06
title: 列表页 useQuery+refetchInterval(30s) 改造 + ChangeStepBadge 接入 + page.test.tsx 适配（覆盖 FR-03, D-001@v1, D-004@v1）
title_zh: 列表页轮询改造与 step 徽章接线
author: qinyi
created_at: 2026-08-16 01:01:55
priority: P0
depends_on: [task-04]
blocks: [task-08]
requirement_ids: [FR-03]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
expects_from:
  task-04: contract ChangeStepBadge 组件（frontend/src/components/changes/change-step-badge.tsx 纯展示 props 接 stage 与 stepProgress，null 时降级只渲染 stage 主行）
  task-03: contract api-types 新契约（ChangeSummary.step_progress 可选字段类型 StepProgressSummary，供页面取行数据传徽章 props）
goal: >
  列表页数据获取由裸 useEffect+useState（page.tsx:116-156 的 load 回调与触发 effect）改 react-query useQuery 智能轮询——
  存在非终态变更 30s 刷新、当前页全终态停轮、页面不可见暂停、structuralSharing 内容不变跳过重渲染（D-001@v1/D-004@v1）；
  阶段列接入 task-04 的 ChangeStepBadge，page.test.tsx 全量适配，请求参数与错误处理语义与改造前逐项一致（R-07）。
implementation:
  - 主 load 改 useQuery——queryKey 含 workspaceId 与全部筛选参数（tab/search/stageFilter/sortDir/focusMine/page/pageSize），queryFn 保持现有 Promise.all 请求（listChanges 全参 + getWorkspace）与 ApiError 取 err.message 否则「加载变更列表失败」的错误语义不变；删 load useCallback、:154-156 触发 effect 及 items/total/loading/pageError/workspace 相关 useState，数据从 query.data 派生，loading 取 query 挂起态
  - refetchInterval 用函数形式——query.state.data 的 items 存在任一非终态变更返回 30000 否则 false；终态判定 status 为 archived 或 location 为 archive（design §5 Phase 2.4 可测试定义），抽纯函数（如 hasActiveChanges/isTerminalChange）便于测试
  - 阶段列（:283-295）渲染换 ChangeStepBadge——传 stage 与行 step_progress（缺省传 null 由组件内部降级 D-003）；本页 STAGE_KIND/STAGE_LABEL 若仅阶段列消费则随之删除
  - handleReparse 成功后刷新与 handleSearchClick 同参重查改 queryClient 失效重取（invalidateQueries 或 refetch），交互语义不变；DataTable rowKey="id"（:551）不变，行级重渲染抑制靠 structuralSharing 默认引用相等
  - page.test.tsx 适配——render 包 QueryClientProvider（retry 关闭，范式照 agent-profile-card.test.tsx），listChanges/getWorkspace mock 与 pageSize 区分主 load 的 helper 保持；新增断言——阶段列渲染徽章摘要副行（step x/y 与当前步名）、step_progress 缺失行降级纯 stage 徽章、终态判定纯函数两分支（非终态返 30000 全终态返 false）
acceptance:
  - 存在非终态变更时列表 30000ms 周期刷新，当前页全部行终态后停轮（无周期请求）
  - 阶段列每行渲染 ChangeStepBadge——有 step 数据显示摘要副行，缺失降级视觉与现状一致
  - 筛选/分页/排序/聚焦/搜索/tab 切换/重扫的请求参数与行为与改造前逐项一致（R-07），错误文案与 loading 态一致
  - page.test.tsx 全绿，tsc 0 error
verify:
  - cd frontend && pnpm exec vitest run "src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx" && pnpm exec tsc --noEmit
constraints:
  - 不改后端；不加新依赖（react-query@5.51 仓库已有全局 Provider）；不改 ChangeStepBadge 组件本体（task-04 交付物，本任务仅消费其 props 契约）
  - 不自研轮询 hook（D-004@v1）——refetchIntervalInBackground 不显式开保持默认 false 即后台暂停；structuralSharing 默认不关
  - tabTotals 独立 effect（:160-177）与待办徽标/负责人列/空态逻辑不在本任务扩散改动，保持现状不轮询
---
