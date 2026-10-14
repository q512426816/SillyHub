---
author: flow-machine-draft
created_at: 2026-10-14T12:28:03.940Z
---
# 任务注册表（Tasks）— 2026-10-14-session-bottom-resize-observer

- [x] task-01: ResizeObserver 观察滚动容器内容高度：任何来源的高度变化（图片/视图/懒渲染/注入）且用户在底部（isNearBottomRef=true）→ rAF 合帧 scrollTo 底，delta 保持 0
- [x] task-02: 用户上滚读历史时高度变化不拉底（isNearBottomRef=false 守卫）
- [x] task-03: 注入复现脚本在修复后 delta 保持 0（部署前后对照取证）
- [x] task-04: rAF 合帧防布局风暴（2026-10-13 layout-storm 教训：高频回调去重为一帧一滚）
- [x] task-05: 兼容无 ResizeObserver 环境（jsdom/旧浏览器优雅降级不挂观测）
- [x] task-06: 既有测试面复跑绿 + tsc 0
