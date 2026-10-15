---
author: flow-machine-draft
created_at: 2026-10-15T02:17:20.398Z
---
# 设计记录（Design Record）— 2026-10-15-graph-type-cluster

## 做法概述

用户实测反馈：neighbors 等查询切片的力场布局里不同类型节点混成一坨。现 slice 力场只有斥力（成对近距）+ 边弹簧 + 向心 0.004 三种力，无任何让同类型靠近的力；而 >200 节点的静态降级 staticLayout 已按类型分环。本变更让力场面对齐该语义：在 stepForceLayout 每步弹簧段之后新增「类型内聚」力——先统计各类型有限坐标节点的质心，再对每个节点施加朝本类型质心的弱牵引（TYPE_COHESION_PULL，量级与 CENTER_PULL 同数量级、略强）。同类成簇、异类被对称斥力推开出块；跨类型边弹簧照常拉出"桥"，正好呈现用户草图期望的形态。选质心牵引而非固定扇区锚：零配置自适应任意类型数、不与既有向心/弹簧参数打架、单成员类型自动零力。

## 接口契约

- `graph-canvas.tsx` 新增具名导出常量 `TYPE_COHESION_PULL: number`（单测消费面）。
- `stepForceLayout` 行为变化：每步在弹簧段后新增类型内聚力累加到速度载体 px/py；函数签名不变。
- 其余全部导出（FORCE_NODE_LIMIT / staticLayout / forceSettled / shouldAutoRefit / fullSimNodes / …）签名与行为不变；full/static 引擎不调用 stepForceLayout，不受影响。
- `page.tsx` 仅说明文案微调（数据面胶囊说明行 + 使用说明 tab 提及同类型聚簇），无状态机与数据链变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：节点数组顺序不影响质心统计（求和归一与顺序无关）；切片数据以 identity 变化整体重建 sim（nodes/edges 同步到达），无迟到事件面。
2. 并发写：stepForceLayout 由单线程 rAF 循环消费 simRef，无并发写；拖拽钉位节点在积分段被整体覆盖 x/y/px/py，内聚力先行累加到其 px/py 与既有斥力/弹簧同帧同语义，无副作用。
3. 切换/生命周期：内聚力无跨帧状态（质心每步重算）；数据重建复位 forceLive/forceSettledFrames 语义不变；收敛后内聚力与其它力同时归零，forceSettled 位移判定与收敛截止不被破坏。
4. 作用域：布局纯函数无工作区/仓/会话状态，多画布实例各自 sim 独立，不串台；确定性仅除既有 NaN 自愈的 Math.random 面（本变更不触碰）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/knowledge/graph-canvas.tsx | stepForceLayout 增补类型内聚力段 + 具名导出 TYPE_COHESION_PULL + 头注释/JSDoc 如实标注增补面 |
| 修改 | frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | 新增「类型内聚力」4 用例（常量导出/聚簇双断言/正控制/豁免闭式解） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx | 数据面胶囊说明行 + 使用说明 tab 文案同步「同类型聚簇」语义 |

## 风险与死路

- 风险一：增益过大会把同类压成重叠团、破坏边弹簧自然长（同类型配对收敛距离被压到自然长以下）。缓解：增益取小（与 CENTER_PULL 同数量级、略强），单测以「类内紧 + 类间分」双断言钉住平衡带，实测定值。
- 风险二：neighbors 切片的锚点节点被拉离画布中心。锚点受其类型簇牵引 + 全邻居弹簧拉向均值，形态为居中偏簇边，选中环与高亮交互不受影响，可接受。
- 试过放弃：①固定扇区锚（每类型钉画布固定方位）——需按类型数动态排布锚点、与向心力直接打架、实现面大，放弃；②仅按类型排序 seedSpiral 初始位——黄金角螺旋相邻索引角差约 137.5°，排序不产生视觉聚堆，且初始位不改变收敛终态，放弃。
