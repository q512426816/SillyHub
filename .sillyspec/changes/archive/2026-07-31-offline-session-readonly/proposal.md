---
author: WhaleFall
created_at: 2026-07-31T11:17:49
---

# 提案（Proposal）— /runtimes 离线只读浏览会话

## 动机

`/runtimes` 页面当 daemon/runtime 离线时，会话功能整个看不见——会话按钮不渲染（`runtime-card.tsx:90-92` `canOpenSession` 要求 online），用户无法进入会话界面查看历史会话与消息内容。但会话列表/历史 API 都是 DB 查询（离线本就能取数据），发送链路也已有 `!hasOnlineProvider` 守卫——离线只读其实已大半具备，只差入口开放 + 只读态呈现。

## 方案概述（方案 A）

InteractiveSessionPanel 加可选 `offlineReadOnly?: boolean` prop，RuntimeSessionDialog 从实时 `runtimes` 重查 `runtime.status` 派生（非 stale runtime prop）传入。离线时：runtime-card 会话按钮仍显示（入口开放）；panel 顶部"运行时离线，只读浏览"横幅 + 4 操作（新建/结束/打断/发送）disabled + active 保持只读（不转 ended）+ attach 不建 SSE 直接读 DB 历史；runtime 重连自动恢复可操作。

## 范围

- 改：3 个前端文件（runtime-card + runtime-session-dialog + interactive-session-panel）+ 测试
- 不改：后端 API（已 DB 查询）、page.tsx URL 恢复（已支持离线 matched）、changes 页 change-session-section（共用 panel 用 prop 隔离）

## 不在范围内（Non-Goals）

- 不改后端 API / schema
- 不改 page.tsx URL 恢复（已支持离线，B1）
- 不改 changes 页会话区（prop 隔离）
- 不改 ended/failed 离线 reopen 降级（现有，符合只读语义）
- 不做"离线编辑后重连同步"（YAGNI）
- 不改 daemon 侧

## 规模

**large**（3 文件 + 跨组件 + 状态契约：active 保持、重连恢复、SSE 离线跳过）。走 plan 阶段。
