---
author: flow-machine-draft
created_at: 2026-10-16T06:31:11.229Z
---
# 任务注册表（Tasks）— 2026-10-16-session-pill-dock-drag

- [x] task-01: 待决策 pill 与变更文件 pill 渲染在同一悬浮组内竖向排列，各自空数据不渲染的显隐契约不变
- [x] task-02: 两 pill 的下拉均为点击展开（hover 不触发）、再点或点外部收起
- [x] task-03: 悬浮组按住可在 viewport 范围内拖动，松手自动吸附较近的左右边界，纵向钳制在窗口内，位置 localStorage 持久化
- [x] task-04: 位移小于阈值视为点击不触发拖拽，拖拽结束后的残余 click 被吞掉，pill 按钮点击行为不受影响
- [x] task-05: 相关组件测试与 tsc 通过
