---
id: task-06
title: '页面默认全图/胶囊两态/下钻/回退链 + 用例更新'
title_zh: '页面默认全图/胶囊两态/下钻/回退链 + 用例更新'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P0
depends_on: [task-05]
blocks: [task-07]
requirement_ids: [FR-04]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
  - frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  - frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
target_files:
  - frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx
  - frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  # ops-dashboard.test.tsx 声明移除：图卡面零改动（回归验证过无需变更——allowed_paths 保留许改权）
goal: >
  默认进页=全图星空（dump 可用）；点全图节点→切查询切片跑该节点 neighbors；胶囊「全图/查询切片」；
  dump 不可用（reason=upgrade_required）→胶囊隐藏+默认回退 orphans。
implementation:
  - useQuery(knowledgeGraphDumpQueryKey, staleTime 5min)；首载 effect：dump 成功→mode='full' 渲染全图；失败（reason=upgrade_required/unavailable）→回退既有 orphans 默认链
  - 点全图节点 onSelect：mode='slice' + 以节点 id 发起 neighbors 查询（复用既有状态机）；胶囊手动回 full
  - 右栏 full 态：图统计卡（stats.nodes/edges/四计数——复用 overview 数据或 dump.stats）+提示「点击节点下钻」
  - lite 胶囊/分支移除；等价 CLI 提示条 full 态显示 dump 命令
  - 用例更新：默认加载 dump/回退链（mock upgrade_required）/点节点下钻断言/胶囊两态/既有 orphans 默认用例改为回退场景/ops-dashboard 零回归
constraints: >
  mode-chip full 态标注「全图 N 节点 · 静态」；全中文；六键降级卡沿既有
acceptance:
  - pnpm test knowledge 全绿；tsc/lint 零错
verify:
  - cd frontend && pnpm test -- knowledge && pnpm exec tsc --noEmit && pnpm lint
---
# task-06

