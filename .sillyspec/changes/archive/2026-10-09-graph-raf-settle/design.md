---
author: flow-machine-draft
created_at: 2026-10-09T19:50:00.000Z
---
# 设计记录（Design Record）— 2026-10-09-graph-raf-settle

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`graph-canvas.tsx` 的 force 引擎 rAF 循环加收敛截止：新增导出纯函数 `forceSettled`（Verlet 步后 x−px 即本帧位移，全节点位移和 < FORCE_SETTLE_EPSILON=0.25 判静止，NaN 防御）+ 组件内 `forceLiveRef`/`forceSettledFramesRef` 两 ref。循环的力场块加 `forceLiveRef.current` 门：步进后累计连续静止帧，达 FORCE_SETTLE_FRAMES=30 即置 false 停步进，并在该帧未交互时做终局 fitView（承接收敛跟随）；数据重建 effect 与拖拽命中分支复位重启。选「停步进保留 rAF 渲染循环」而非「取消 rAF 按需重启」：渲染循环本就有 dirty 早退（非 dirty 帧仅一个空回调，成本可忽略），取消/重启 rAF 需要在所有 dirty 置位点接线，改动面大收益边际。连续 30 帧守卫防弹簧转折点瞬时零速误判（单帧判定会在振荡系统上早停）；拖拽活跃守卫（dragRef 非空不判静止）防被拖节点位移恒零导致的误停冻结（首轮评审 P1 修复）；forceSettled 对 px/py 的 NaN 同防御（NaN>x 恒 false 缝隙，首轮评审 P3 修复）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `frontend/src/components/knowledge/graph-canvas.tsx`：新导出 `forceSettled(nodes, maxDisp?)`、`FORCE_SETTLE_EPSILON`、`FORCE_SETTLE_FRAMES`；组件内部行为变化=力场收敛后停步进 + 终局 fit + 拖拽/重建重启。既有导出零变化。
- 测试文件补 forceSettled 4 用例 + 恢复 shouldAutoRefit 2 用例（fullmap 重写丢失）。
- HTTP / 后端 / 类型：零变化。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立。数据重建 effect 复位 forceLive（新数据到达即重启演化，迟到旧帧无独立状态面）；收敛计数只由步进路径推进，无并发写者（单 rAF 循环串行）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用：所有 ref 由同一 rAF 循环与 React 事件处理器在主线程串行读写，无并发执行体。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：ref 是组件实例态，卸载随 rAF cleanup 消亡；停步进后用户交互（滚轮/平移/缩放）仍置 dirty 正常重绘——渲染职责未动。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：ref 作用域在单画布实例；纯函数无状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：阈值/帧数参数不优——epsilon 过大在微振荡期早停（布局略欠收敛），过小则长尾难达（30 帧守卫要求持续静止，阻尼系统指数衰减下 0.25px/帧 可达，联测 6000 步内实证收敛）。终局 fit 只在未交互时执行，交互过的用户视口不受打扰。试过放弃：(a) 取消 rAF 按需重启——放弃，dirty 早退已让空帧成本趋零，接线面大；(b) 单帧判定收敛——放弃，弹簧转折点瞬时零速会误判（oscillator 在振幅处速度为零）；(c) 全局静止能量阈值——放弃，px/py 位移已是现成速度代理，无需新载体。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/knowledge/graph-canvas.tsx | forceSettled 纯函数 + 常量 + 循环收敛截止接线 + 拖拽/重建重启 |
| 修改 | frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | forceSettled 4 用例 + shouldAutoRefit 2 用例恢复 |
