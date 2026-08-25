---
author: qinyi
created_at: 2026-08-25 15:30:00
---
# 提案（Proposal）— /runtimes 会话入口统一为智能会话助手（锁定 runtime）+ 抽屉列表换工作区树

## 背景

`/runtimes` 页运行时卡片的「会话」按钮当前打开旧版 `RuntimeSessionDialog` 弹窗（左紧凑列表 + 右对话面板），与 2026-08-25 上线的全局悬浮「智能会话助手」形态割裂；且悬浮助手抽屉左侧「最近 10 条」扁平列表与 `/sessions` 页工作区树样式/能力不一致。用户要求：/runtimes 入口直接唤起悬浮助手（锁定机器+智能体），抽屉左侧列表按 /sessions 树样式展示。

## 目标

1. /runtimes「会话」按钮唤起悬浮会话助手并锁定当前 runtime（头部锁定徽标 + 新建钉死 + 列表只看该 runtime 会话）。
2. 悬浮抽屉左侧列表替换为 /sessions 页同款工作区树 `SessionListPanel`（全功能：搜索/两层筛选/分组/归档/批量/展开记忆）。
3. 抽屉加宽至约 960px 容纳 320px 树栏。

## 不在范围内（Non-Goals）

- 不改 backend/daemon 协议与端点（runtime_id 过滤为既有能力）。
- 不改 SessionPanel 内核。
- 不做悬浮↔门户会话无缝迁移。
- 不改造 ChangeSessionSection（change 详情页会话区）。

## 方案

方案A（用户选定）：壳 store 加 `lockedRuntime`，SessionListPanel 加 `scope:runtime` 变体，抽屉换树+加宽，/runtimes 按钮接线改为唤起悬浮。详见 design.md §3。
