---
author: flow-machine-draft
created_at: 2026-10-14T02:34:28.807Z
---
# 任务注册表（Tasks）— 2026-10-14-logout-full-reload-clear-cache

- [x] task-01: 桌面端确认退出后整页跳转 /login，内存缓存（QueryClient/zustand/模块级）随页面重置，不再 SPA 内跳
- [x] task-02: 移动端退出后整页跳转 /m/login，同上
- [x] task-03: 补登出跳转方式测试：两处断言 window.location.assign 被调用且不再走 router.replace
- [x] task-04: 现有相关测试（app-shell / m-account / auth）不回归
