---
author: flow-machine-draft
created_at: 2026-10-08T23:44:12.992Z
---
# 任务注册表（Tasks）— 2026-10-09-graph-raf-settle

- [x] task-01: 力场收敛后停止 stepForceLayout 步进（连续 FORCE_SETTLE_FRAMES 帧全节点位移低于 FORCE_SETTLE_EPSILON 判收敛，转折点零速误判由连续帧守卫）
- [x] task-02: 收敛定格时若用户未交互，做一次终局 fitView（承接收敛跟随语义，tick 计数随之停止不缺帧）
- [x] task-03: 数据重建与用户拖拽节点都重启力场（新布局重新演化、拖放后重收敛）
- [x] task-04: 判定提取为导出纯函数 forceSettled 供测试；与真实积分器联测（步进至收敛）
- [x] task-05: 既有 graph-canvas 测试全绿，tsc/eslint 0
