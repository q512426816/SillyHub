---
author: flow-machine-draft
created_at: 2026-10-23T02:54:13.100Z
---
# 决策记录（Decisions）— 2026-10-23-live-turn-meta-time

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：RoundDivider 是 memo 组件，detail 从 string（值相等可命中 memo）变为运行中轮每渲染新建的 React 元素 → 该轮 RoundDivider memo 恒 miss。评估：仅单条运行中轮受影响、RoundDivider 渲染成本极小（几个 span），且运行中轮本就随流式 delta 高频重渲染（tokens meta 同步变化），无可感差异；终态轮 detail 仍是 string，memo 命中率不变。 放弃方案：① 父级 TurnRow 持 interval 整体重算 metaDetail——每秒整轮重渲染，违反渲染经济铁律（FR-06 惯例，TurnStatusBar 注释明载 tick 不外溢），放弃；② 只改数据层（running → replyAt=null）——该位置整体消失，不满足「进行中显示实时走秒历时」的用户裁决，放弃；③ RoundDivider 开专用 liveElapsed prop——为单场景在共享组件上扩接口面，比向后兼容的类型放宽侵入更大，放弃。
