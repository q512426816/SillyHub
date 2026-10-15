---
author: flow-machine-draft
created_at: 2026-10-15T03:09:55.835Z
---
# 任务注册表（Tasks）— 2026-10-15-change-assets-graph

- [x] task-01: graph-canvas.tsx 导出 NODE_TYPE_LABELS（自图谱页迁入）+ 图谱页 page.tsx 改 import；新建 change-assets-graph.tsx（neighbors 切片取数 + GraphCanvas + 右侧节点详情栏 + 默认选中锚点 + fail-open 隐藏）并挂载进 change-assets-card.tsx 展开态顶部；验证：pnpm exec vitest run change-assets-graph.test.tsx（新）+ change-assets-card.test.tsx（既有回归）全绿。
- [x] task-02: page.tsx 主栏 ChangeAssetsCard 挂载点上移至步骤时间线 section 之前；page-restore-assets.test.tsx 补 DOM 顺序钉子用例（沉淀资产在步骤时间线之前）；验证：pnpm exec vitest run page-restore-assets.test.tsx 全绿。
- [x] task-03: page.tsx 步骤时间线 stepsOpen state（默认收起）+ 卡头切换按钮 + focusStage 联动自动展开；page-team-toggle.test.tsx 时间线用例改「默认收起→点开展开断言组件体」；验证：pnpm exec vitest run page-team-toggle.test.tsx 全绿。
- [ ] task-04: change-stage-actions.tsx 无待审分支改 return null；change-stage-actions.test.tsx 无待审用例改断言渲染 null（thin/quick/审批面板三支既有断言不动）；验证：pnpm exec vitest run change-stage-actions.test.tsx 全绿。
- [ ] task-05: 相关面回归：change-assets-graph/card/stage-actions + page-team-toggle/page-restore-assets 五文件复跑 0 fail；验证：输出汇总全绿。
