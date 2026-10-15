---
author: flow-machine-draft
created_at: 2026-10-15T05:48:35.592Z
---
# 提案书（Proposal）— 2026-10-15-assets-graph-narrow-typecheck

## 动机

任务原话转写：动机一行：2026-10-15-change-assets-graph 归档交付的 change-assets-graph.tsx 在 pre-push ci-fast-gate typecheck 报 TS2339——"anchor" in data 收窄对经 env.data ?? null 推断链产生的联合失效（保留非 neighbors 成员交叉 Record<"anchor",unknown>），data.nodes/edges 访问不过编译，推送被闸门拦下。
成功标准：
- 前端 pnpm exec tsc --noEmit 0 错（ci-fast-gate typecheck 可过）
- change-assets-graph 组件既有用例全绿，收窄语义（非 neighbors 分型/空数据隐藏分区）不变
- 守卫落在 knowledge.ts 紧邻 getKnowledgeGraphQuery，带中文注释说明为何不用裸 in 收窄

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 前端 pnpm exec tsc --noEmit 0 错（ci-fast-gate typecheck 可过）
2. change-assets-graph 组件既有用例全绿，收窄语义（非 neighbors 分型/空数据隐藏分区）不变
3. 守卫落在 knowledge.ts 紧邻 getKnowledgeGraphQuery，带中文注释说明为何不用裸 in 收窄

## 成功标准（可验证）

1. 前端 pnpm exec tsc --noEmit 0 错（ci-fast-gate typecheck 可过）
2. change-assets-graph 组件既有用例全绿，收窄语义（非 neighbors 分型/空数据隐藏分区）不变
3. 守卫落在 knowledge.ts 紧邻 getKnowledgeGraphQuery，带中文注释说明为何不用裸 in 收窄
