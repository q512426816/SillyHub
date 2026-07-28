---
id: task-09
title: "frontend/src/components/llm-providers/llm-provider-list.tsx 每行挂 <UsageFooter> + 「查余额」按钮；useEffect 进页面自动对支持用量的供应商查一次；手动按钮触发单家刷新。覆盖 FR-06, D-006。依赖 task-08, task-06。"
title_zh: 列表每行挂用量展示+进页面自动查+手动刷新
author: qinyi
created_at: 2026-07-28 10:37:44
priority: P0
depends_on: [task-08, task-06]
blocks: []
requirement_ids: [FR-06]
decision_ids: [D-006@v1]
allowed_paths:
  - frontend/src/components/llm-providers/llm-provider-list.tsx
provides: []
expects_from:
  task-08:
    - contract: UsageFooter
      needs: [props]
  task-06:
    - contract: queryUsage
      needs: [id, response]
goal: >
  列表每行挂 UsageFooter 组件，进页面自动对支持用量的供应商查一次用量，
  「查余额」按钮手动触发单家刷新，不影响现有启动/停止/编辑/删除按钮。
implementation:
  - 每行卡片底部（modelSummary 行之后）挂 <UsageFooter>（task-08 组件），传该行 queryUsage 结果 + loading/查询时间 + onRefresh 回调，照 task-08 props 契约。
  - 用 React Query（或既有 useState/useEffect 模式）按 provider.id 缓存 queryUsage 结果（task-06 调 POST /api/llm-providers/{id}/usage），key 去重避免重复请求。
  - 进页面 useEffect（依赖 providers 加载完成）对支持用量的供应商自动查一次（Promise.allSettled 并发，仅一次不轮询，D-006）。
  - 每行操作区（启动/编辑/删除旁）加「查余额」按钮，点击触发单家刷新（invalidate 该 key），RefreshCw 旋转反馈；错误两态/不支持文案/保留上次值统一交 UsageFooter 处理，list 层不重复实现。
  - 现有 list↔form 状态机、启动/停止/编辑/删除、顶部刷新按钮均不动；brownfield 仅追加 footer 挂载 + 自动/手动查逻辑。
acceptance:
  - 进页面自动对支持用量的供应商查一次（useEffect 触发，不轮询、无风暴）。
  - 「查余额」按钮手动触发单家刷新，刷新中有反馈（旋转/禁用）。
  - 不支持用量的供应商行显示中性文案（由 UsageFooter 渲染），不报错。
  - 不影响现有启动/停止/编辑/删除/刷新按钮与 list↔form 状态机。
  - 并发查询受控（按 provider.id 去重/限流），不重复请求同一 provider。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/llm-providers
constraints:
  - 进页面自动查仅一次（useEffect 依赖稳定，不轮询/不 refetchInterval，避免请求风暴 D-006）。
  - 遵循设计系统样式（卡片 border/bg-card、tabular-nums、中文文案），按钮尺寸风格与现有行内按钮一致。
  - brownfield：不破坏现有列表交互与状态机，仅追加 UsageFooter 挂载 + 自动/手动查。
---
