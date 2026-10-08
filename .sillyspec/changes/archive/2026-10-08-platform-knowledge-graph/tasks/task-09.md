---
id: task-09
title: '前端测试：canvas 纯函数/页面三态与状态机/图卡三态 + tsc/eslint'
title_zh: '前端测试：canvas 纯函数/页面三态与状态机/图卡三态 + tsc/eslint'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-08 17:50:00
priority: P1
depends_on: [task-07, task-08]
blocks: [task-10]
requirement_ids: [FR-05, FR-06, FR-07]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/knowledge/__tests__/graph-canvas.test.ts
  - frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  - frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
target_files:
  - NEW:frontend/src/components/knowledge/__tests__/graph-canvas.test.ts
  - NEW:frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx
  - frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
goal: >
  前端测试面：canvas 几何/力场/布局纯函数单测（jsdom 不可测 canvas 交互的补偿，frontend/src/components/git-log/commit-graph.tsx 先例）+ 页面三态
  与 lite↔切片状态机 mock 用例 + 图卡三态；tsc/eslint 零错。
implementation:
  - graph-canvas.test.ts（纯函数）：stepForceLayout 三步收敛断言（两节点弹簧距离趋近自然长、NaN 自愈）；pickNode 最近者胜+容差；fitView 包围盒与缩放夹；staticLayout >200 降级触发（节点数 201）；liteClusterLayout 簇摆放确定性（同输入同输出）；edgeDash 三档映射
  - knowledge-graph-page.test.tsx：mock lib/knowledge.ts 三函数——三态（pending 骨架/unavailable 六键各一文案断言/可用渲染 orphans 默认查询发起）；lite↔切片状态机（点代表→切切片且发起 neighbors；胶囊回 lite）；补全不可用静默禁用；entry 深链 href 断言
  - ops-dashboard.test.tsx 扩展：图卡三态（正常数值+点开清单行跳转 href/unavailable 引导/None→"—"）；既有四卡断言零回归
  - 全部 vitest + @testing-library，中文断言文案
acceptance:
  - cd frontend && pnpm test 相关文件全绿；tsc --noEmit 零错；eslint 零新错
verify:
  - cd frontend && pnpm test -- graph knowledge
  - cd frontend && pnpm exec tsc --noEmit && pnpm lint
constraints: >
  canvas 交互不可测部分以纯函数导出覆盖；既有用例零回归
---
# task-09
