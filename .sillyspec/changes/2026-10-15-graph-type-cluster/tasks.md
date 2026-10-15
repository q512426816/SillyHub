---
author: flow-machine-draft
created_at: 2026-10-15T02:17:20.398Z
---
# 任务注册表（Tasks）— 2026-10-15-graph-type-cluster

- [x] task-01: 写单测先行（frontend/src/components/knowledge/__tests__/graph-canvas.test.ts）：新增「类型内聚力」用例组——增益常量具名导出断言、交错网格 3 类型×6 节点快进 4000 步聚簇双断言（类内离质心最大距离 <150 且异类质心两两间距 >150）、单成员类型/NaN 坐标豁免断言（NaN 自愈 160 圆环口径复用既有）；验证：pnpm vitest run 该文件，新用例红（常量未导出编译错）。
- [x] task-02: 实现（frontend/src/components/knowledge/graph-canvas.tsx）：导出常量 TYPE_COHESION_PULL；stepForceLayout 每步弹簧段后统计各类型有限坐标质心，对成员数 >1 的类型施加朝质心弱牵引（单成员/NaN 豁免，拖拽钉位节点照常累加由积分段覆盖）；验证：pnpm vitest run graph-canvas.test.ts 全文件绿（含既有用例不改断言）。
- [x] task-03: 页面文案微调（frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx）：数据面胶囊说明行与使用说明 tab 提及「同类型聚簇」语义；验证：pnpm vitest run knowledge-graph-page.test.tsx 全绿。
- [x] task-04: 相关面回归收尾：graph-canvas.test.ts + knowledge-graph-page.test.tsx 两文件复跑全绿，核对 full/static 引擎路径未被触碰（fullSimNodes/staticLayout 无 diff 语义变化）；验证：两测试文件输出汇总 0 fail。
