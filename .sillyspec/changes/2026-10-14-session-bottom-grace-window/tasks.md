---
author: flow-machine-draft
created_at: 2026-10-15T02:08:56.580Z
---
# 任务注册表（Tasks）— 2026-10-14-session-bottom-grace-window

- [x] task-01: RO 钉底条件扩为 isNearBottomRef ||（距最近贴底 <10s 且无用户输入）——加载期 near 被误清后宽限窗内自动钉底
- [x] task-02: 用户真实滚动（滚轮/触摸/拖动）立即恢复既有让权语义（near=false 后不强拉）
- [x] task-03: 挂载即视为在窗内（初始加载全程受保护），超过 10s 或用户输入后回到既有语义
- [x] task-04: 既有测试面复跑绿 + tsc 0
