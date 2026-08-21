---
author: qinyi
created_at: 2026-08-21T17:10:00
change: 2026-08-21-session-message-queue
---

# 模块影响分析

## 影响的模块

| 模块 | 影响类型 | 说明 |
|---|---|---|
| frontend/daemon | 新增 + 修改 | 新建 hook、组件；修改 sessions/page.tsx |
| frontend/app | 修改 | sessions/page.tsx 改用 SessionPanel；runtimes/page.tsx 替换面板 |

## 无影响的模块

- backend/（零改动）
- sillyhub-daemon/（零改动）
- 其他 frontend 模块（无依赖变更）
