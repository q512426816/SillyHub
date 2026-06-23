---
author: qinyi
created_at: 2026-06-23 10:09:12
---

# SillySpec Quick Log

## ql-20260623-003-7c2e | 2026-06-23 10:09:12 | TopBar 用户菜单新增「切换平台」入口 + 退出登录二次确认 + 侧边栏 LOGO 处显示平台名称
状态：已完成
结果：6 测试全过（top-bar 2 + logout-confirm-dialog 4）；tsc 改动文件无类型错误；eslint 无 warning。
实际改动文件：
- frontend/src/components/top-bar.tsx（导出 resolvePlatformSwitch 纯函数；用户菜单新增「切换平台」项，文案/跳转随当前平台切换）
- frontend/src/components/app-shell.tsx（退出登录拆 requestLogout/performLogout + 渲染确认弹窗；侧边栏 Brand 区 LOGO 旁显示当前平台名称；LOGO 链接随平台指向各自首页）
- frontend/src/components/logout-confirm-dialog.tsx（新建：退出登录二次确认弹窗，基于 ui/dialog）
- frontend/src/components/__tests__/top-bar.test.tsx（新建：resolvePlatformSwitch 平台判断纯函数，2 用例）
- frontend/src/components/__tests__/logout-confirm-dialog.test.tsx（新建：确认/取消回调，4 用例）
