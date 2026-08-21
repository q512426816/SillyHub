---
author: qinyi
created_at: 2026-08-21T16:45:00
change: 2026-08-21-session-message-queue
---

# 提案：会话消息排队 + 组件统一

## 概述

改造会话输入体验：输入框始终可用（除终态/离线），running/reconnecting 时消息排队，turn 结束或 active 后自动投递下一条。同时统一 `/sessions` 和 `/runtimes` 页面的会话组件为单一实现。

## 动机

当前会话输入框在 running/reconnecting 状态被禁用，用户体验割裂：
- 要等 agent 回完才能输入
- reconnecting 时完全无法交互
- 两个页面各自维护独立的会话面板，逻辑重复

## 方案

1. 新建 `useMessageQueue` hook：管理队列状态、自动投递逻辑
2. 新建 `MessageQueueBar` 组件：队列条目可视化展示
3. 从 `sessions/page.tsx` 提取 `SessionPanel` 共享组件
4. `/runtimes` 页面替换 `interactive-session-panel.tsx` 为 `SessionPanel`
5. 后端零改动

## 不在范围内（Non-Goals）

- 后端改动（inject 仍需 status=active，前端负责时序）
- 跨窗口消息队列（单浏览器 tab 内）
- 消息优先级/重排序
- interactive-session-panel 的弹窗容器改造（只替换面板内容，不动弹窗外壳）

- **包含**：消息队列（5条上限、失败标记、附件排队）、组件统一（SessionPanel 提取+替换）
- **不包含**：后端改动、跨窗口队列、消息优先级/重排序、interactive-session-panel 的弹窗容器改造

## 预期收益

- 用户体验：输入无阻断，连续对话更自然
- 维护性：单一会话组件，修 bug 只改一处
- 代码量：净减少（删 1300 行 interactive-session-panel，加 ~300 行共享组件+hook）
