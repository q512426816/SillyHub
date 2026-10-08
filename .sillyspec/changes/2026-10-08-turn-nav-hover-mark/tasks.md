---
author: flow-machine-draft
created_at: 2026-10-08T03:19:39.993Z
---
# 任务注册表（Tasks）— 2026-10-08-turn-nav-hover-mark

- [x] task-01: turn-nav-list.tsx 新增 hoverTurnKey state，窄轨刻度与浮层行挂 onMouseEnter 写入（浮层行渲染 isHovered 时加 ring-1 ring-inset ring-brand-400 + data-hovered）——验证：tsc 编译过 + 既有用例绿
- [x] task-02: 四个收起点同步清指向（组件 mouseleave 250ms 防抖回调 / togglePin / 组件外 pointerdown / 行跳转收起）——验证：新增清除用例断言重展开无残留标记
- [x] task-03: 滚动联动 effect 扩为指向优先（hoverTurnKey ?? activeTurnKey，block:nearest），指向清除回落 active——验证：单测断言 scrollIntoView 调用
- [ ] task-04: 新增 FR-01/02 用例（指向标记渲染与 active 区分、刻度滑动跟随、浮层行同步）——验证：vitest run 新用例绿
- [ ] task-05: vitest run 全测试文件 + 该文件 eslint，既有用例零回归——验证：全绿 + 0 error
