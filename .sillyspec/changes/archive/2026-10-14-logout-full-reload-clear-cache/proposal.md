---
author: flow-machine-draft
created_at: 2026-10-14T02:34:28.807Z
---
# 提案书（Proposal）— 2026-10-14-logout-full-reload-clear-cache

## 动机

任务原话转写：动机：登出换账号后页面仍显示上一用户的工作区/会话等数据——主动登出走 router.replace SPA 跳转，React Query 缓存与内存 zustand store 未随页面销毁（401 被动登出走整页跳转无此问题）。
成功标准：
- 桌面端确认退出后整页跳转 /login，内存缓存（QueryClient/zustand/模块级）随页面重置，不再 SPA 内跳
- 移动端退出后整页跳转 /m/login，同上
- 补登出跳转方式测试：两处断言 window.location.assign 被调用且不再走 router.replace
- 现有相关测试（app-shell / m-account / auth）不回归

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 桌面端确认退出后整页跳转 /login，内存缓存（QueryClient/zustand/模块级）随页面重置，不再 SPA 内跳
2. 移动端退出后整页跳转 /m/login，同上
3. 补登出跳转方式测试：两处断言 window.location.assign 被调用且不再走 router.replace
4. 现有相关测试（app-shell / m-account / auth）不回归

## 成功标准（可验证）

1. 桌面端确认退出后整页跳转 /login，内存缓存（QueryClient/zustand/模块级）随页面重置，不再 SPA 内跳
2. 移动端退出后整页跳转 /m/login，同上
3. 补登出跳转方式测试：两处断言 window.location.assign 被调用且不再走 router.replace
4. 现有相关测试（app-shell / m-account / auth）不回归
