---
author: flow-machine-draft
created_at: 2026-10-13T06:43:06.704Z
---
# 提案书（Proposal）— 2026-10-13-turn-nav-initial-scroll

## 动机

任务原话转写：会话页轮次导航窄轨首挂载不滚向当前轮:P3 留债(归档件 2026-10-13-turn-nav-rail-overflow-fix finding)。轨内滚动修复后,长会话打开时轨道 scrollTop 停顶部,当前轮(最新)刻度在可视区外,用户看不到当前轮位置;把手 #N 可见但刻度高亮不可见。依据:turn-nav-list.tsx:243-247 mountedRef 守卫「首挂载不滚」为 2026-09-08 TurnCatalog 居中形态时代的决策,窄轨+轨内滚动形态下语义反转。成功标准:
- 首挂载带 activeTurnKey 时窄轨刻度立即 scrollIntoView(block:nearest)对齐当前轮,打开长会话即见当前轮高亮
- activeTurnKey 为 null(无活跃轮)首挂载不滚
- active 变化/hover 指向/浮层展开的既有滚动联动语义不变
- 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. activeTurnKey 为 null(无活跃轮)首挂载不滚
2. active 变化/hover 指向/浮层展开的既有滚动联动语义不变
3. 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿

## 成功标准（可验证）

1. activeTurnKey 为 null(无活跃轮)首挂载不滚
2. active 变化/hover 指向/浮层展开的既有滚动联动语义不变
3. 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿
