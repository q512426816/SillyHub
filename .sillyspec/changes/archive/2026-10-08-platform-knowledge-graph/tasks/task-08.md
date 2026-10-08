---
id: task-08
title: 'workspace-tabs 页签 + OpsDashboard 图维度卡'
title_zh: 'workspace-tabs 页签 + OpsDashboard 图维度卡'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P1
depends_on: [task-05]
blocks: [task-09]
requirement_ids: [FR-05, FR-07]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/workspace-tabs.tsx
  - frontend/src/components/knowledge/ops-dashboard.tsx
target_files:
  - frontend/src/components/workspace-tabs.tsx
  - frontend/src/components/knowledge/ops-dashboard.tsx
goal: >
  入口与图健康度卡：workspace-tabs 加「知识图谱」页签（知识库后）；OpsDashboard 指标网格加图维度卡（孤儿/
  悬空计数+点开清单跳图谱页+绑定引导），既有四卡与 stats() 零回归。
implementation:
  - workspace-tabs.tsx TABS 数组「知识库」项后插 {key:"knowledge-graph", label:"知识图谱", path:"/knowledge/graph"}（菜单权限复用 knowledge 卡：matchPattern "/knowledge" startsWith 前缀天然覆盖 /knowledge/graph，无菜单改动）
  - ops-dashboard.tsx：指标网格（sm:grid-cols-2）加「图·孤儿」「图·悬空」两子卡——label text-[11px] text-muted-foreground（口径小注「知识图完整性」）、主数值 text-[22px] font-bold text-warning、点开 useState 清单（max-h overflow-y-auto rounded-md border bg-muted/30，行=锚点+kind，点击 → /knowledge/graph?preset=orphans|dangling 深链）；数据 useQuery(knowledgeGraphOverviewQueryKey)（与 page.tsx 同 key 共享缓存零额外请求）
  - 三态：overview available=false → 卡位绑定引导文案（含 reason 键分支文案）；计数字段 ?? None 防御渲染 "—"；isError → 卡位静默占位（沿用 :94-122 版位占住惯例）
  - 既有四指标卡/HitsService 面零改动
acceptance:
  - 页签出现且权限复用生效（knowledge:read 可见）
  - 图卡三态正确；点开清单跳转图谱页对应 preset
  - 既有 ops-dashboard 用例零回归（task-09 扩展断言）
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints: >
  既有四指标卡与 stats() 零回归；图卡数据与图谱页共享 query key 缓存
---
# task-08
