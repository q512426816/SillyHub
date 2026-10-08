---
id: task-05
title: 'GraphCanvas full 模式静态渲染 + lite 分支移除 + 纯函数测试'
title_zh: 'GraphCanvas full 模式静态渲染 + lite 分支移除 + 纯函数测试'
author: 'qinyi'
created_at: '2026-10-09 00:52:00'
priority: P0
depends_on: [task-04]
blocks: [task-06]
requirement_ids: [FR-04, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/knowledge/graph-canvas.tsx
  - frontend/src/components/knowledge/__tests__/graph-canvas.test.ts
target_files:
  - frontend/src/components/knowledge/graph-canvas.tsx
  - frontend/src/components/knowledge/__tests__/graph-canvas.test.ts
goal: >
  mode:'full' 静态渲染分支：dump 节点带预计算 x/y 直接摆放（不进力场引擎不 seedSpiral）；
  k<0.5 只画节点不画边（新增性能护栏）；标签只在大半径类型（module/project/doc）或 k>1.35；
  lite 渲染分支移除（liteClusterLayout 纯函数+其单测保留）。
implementation:
  - full 分支：toSimNode 消费 n.x/n.y（px/py 初始化同值）；engine='full'（rAF 循环不步进力场只按 dirty 重绘）；fitView 初始
  - 边绘制护栏：k<0.5 跳过 drawEdges（谓词导出 shallDrawEdges(k) 供单测）
  - 标签分级：type∈{module,project,doc} || k>1.35 || hover/选中（原型 HTML:396 同值）
  - lite 渲染分支删除（mode 类型收窄 'slice'|'full'；liteClusterLayout 导出保留+注释标注保留原因）
  - 测试：full 模式不步进力场（节点坐标恒等于输入）/shallDrawEdges(0.4)=false/(1.0)=true/标签谓词/full fitView 包围盒/lite 用例保留绿
constraints: >
  三主题零硬编码 hex（full 分支同 palette）；全图节点>200 恒静态（本就不进力场——与既有 FORCE_NODE_LIMIT 语义正交）
acceptance:
  - pnpm test graph-canvas 全绿；tsc/lint 零错
verify:
  - cd frontend && pnpm test -- graph-canvas && pnpm exec tsc --noEmit
---
# task-05

