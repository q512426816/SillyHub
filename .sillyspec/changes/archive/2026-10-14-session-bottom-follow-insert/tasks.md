---
author: flow-machine-draft
created_at: 2026-10-14T07:02:14.045Z
---
# 任务注册表（Tasks）— 2026-10-14-session-bottom-follow-insert

- [x] task-01: 大纲后到（中段插入预览卡/孤儿补建尾部追加）且用户贴底时，视口跟随滚到底（保持所见内容不变）
- [x] task-02: 触顶翻页 prepend 不被误触发贴底（isPrepend 早退 + 3s 静默窗既有守卫不变）
- [x] task-03: 用户上滚读历史时中段插入不强拉底部（isNearBottomRef 守卫不变）
- [x] task-04: 跳转期间不贴底（suppressFollowBottom 语义不变）
- [x] task-05: 既有贴底/翻页/跳转相关测试面复跑绿 + tsc 0
