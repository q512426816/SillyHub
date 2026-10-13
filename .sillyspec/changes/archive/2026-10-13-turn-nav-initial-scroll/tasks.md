---
author: flow-machine-draft
created_at: 2026-10-13T06:43:06.704Z
---
# 任务注册表（Tasks）— 2026-10-13-turn-nav-initial-scroll

- [x] task-01: 首挂载带 activeTurnKey 时窄轨刻度立即 scrollIntoView(block:nearest) 对齐当前轮（删 mountedRef 首渲守卫）
- [x] task-02: activeTurnKey 为 null(无活跃轮)首挂载不滚
- [x] task-03: active 变化/hover 指向/浮层展开的既有滚动联动语义不变
- [x] task-04: 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿
