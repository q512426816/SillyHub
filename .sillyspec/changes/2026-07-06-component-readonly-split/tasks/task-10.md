---
id: task-10
title: create-change 候选源切换 + topology 退化
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P1
depends_on: [task-08]
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-004@V1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/create-change/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx
goal: >
  create-change 选组件候选源切到新 listComponents（提交链路不变）；topology 页退化为只项目组节点（或整页隐藏），落实 R-07 决策。
implementation:
  - `create-change/page.tsx`：候选组件源改调 `listComponents`（task-08 已切到 GET /components），提交时仍用 component_key 字符串数组（affected_components 链路不动）
  - `topology/page.tsx`：退化方案二选一（本任务拍板）——(a) 只渲染项目组节点无边 + 保留页面入口；(b) 整页隐藏/重定向到 components。倾向 (a)，保留入口
  - 若选 (a)：调 GET /workspaces/topology 取 nodes，不渲染 edges
acceptance:
  - create-change 页候选组件列表正常显示（5 个一级子项目），选组件后提交成功
  - topology 页不报错；选 (a) 时只显示项目组节点无边
  - 控制台无 404
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run src/app/\(dashboard\)/workspaces/\[id\]/create-change src/app/\(dashboard\)/workspaces/\[id\]/components/topology
constraints:
  - create-change 提交 payload 结构不动（仍是 component_key 字符串）
  - topology 方案需在实现时确定并记入 quicklog
  - P1：若 create-change 候选源依赖 task-08 完成验证，需先确认 task-08 已合
---

