---
author: flow-machine-draft
created_at: 2026-10-08T23:44:12.992Z
---
# 提案书（Proposal）— 2026-10-09-graph-raf-settle

## 动机

任务原话转写：动机：24 小时风险审查实证 graph-canvas.tsx 力场 rAF 循环无收敛截止——force 引擎 ≤200 节点时每帧 O(n²) 步进 + 恒置 dirty 重绘，页面开着恒耗 CPU（n≤200 上限封顶约 2 万对/帧），布局早已静止仍在烧。

成功标准：
- 力场收敛后停止 stepForceLayout 步进（连续 FORCE_SETTLE_FRAMES 帧全节点位移低于 FORCE_SETTLE_EPSILON 判收敛，转折点零速误判由连续帧守卫）
- 收敛定格时若用户未交互，做一次终局 fitView（承接收敛跟随语义，tick 计数随之停止不缺帧）
- 数据重建与用户拖拽节点都重启力场（新布局重新演化、拖放后重收敛）
- 判定提取为导出纯函数 forceSettled 供测试；与真实积分器联测（步进至收敛）
- 既有 graph-canvas 测试全绿，tsc/eslint 0

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 力场收敛后停止 stepForceLayout 步进（连续 FORCE_SETTLE_FRAMES 帧全节点位移低于 FORCE_SETTLE_EPSILON 判收敛，转折点零速误判由连续帧守卫）
2. 收敛定格时若用户未交互，做一次终局 fitView（承接收敛跟随语义，tick 计数随之停止不缺帧）
3. 数据重建与用户拖拽节点都重启力场（新布局重新演化、拖放后重收敛）
4. 判定提取为导出纯函数 forceSettled 供测试；与真实积分器联测（步进至收敛）
5. 既有 graph-canvas 测试全绿，tsc/eslint 0

## 成功标准（可验证）

1. 力场收敛后停止 stepForceLayout 步进（连续 FORCE_SETTLE_FRAMES 帧全节点位移低于 FORCE_SETTLE_EPSILON 判收敛，转折点零速误判由连续帧守卫）
2. 收敛定格时若用户未交互，做一次终局 fitView（承接收敛跟随语义，tick 计数随之停止不缺帧）
3. 数据重建与用户拖拽节点都重启力场（新布局重新演化、拖放后重收敛）
4. 判定提取为导出纯函数 forceSettled 供测试；与真实积分器联测（步进至收敛）
5. 既有 graph-canvas 测试全绿，tsc/eslint 0
