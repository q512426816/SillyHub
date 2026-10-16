---
author: flow-machine-draft
created_at: 2026-10-16T05:37:22.887Z
---
# 设计记录（Design Record）— 2026-10-16-decision-pill-no-workspace

## 做法概述

根因：2026-10-16-session-decision-pill task-04 把悬浮行挂载条件写成 `sessionId != null && session?.workspace_id != null`（沿变更文件 pill 先例），待决策 pill 只消费 sessionId 却被 workspace 门连坐——老会话 workspace_id 为空（如 445e12d9，10-09 创建早于工作区绑定约束）时整个悬浮行不挂载。修复：行门槛放宽为仅 `sessionId != null`，变更文件 pill 子槽保留自己的 `session?.workspace_id != null` 门（其 API 需要 workspace，缺省不渲染零占位契约不变）。改动仅 frontend/src/components/daemon/session-panel/session-panel-page.tsx 挂载条件一处。

## 接口契约

无接口变更（零端点/零 schema）。组件 props 契约不变（SessionDecisionsHover 仍只收 sessionId/pendingRequests/planPending/onFocusPending）；可见行为变化仅一条：无 workspace 会话从"悬浮行整体不渲染"变为"待决策 pill 渲染、变更文件 pill 不渲染"。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：不适用——挂载条件是同步派生（session detail query 解析后渲染），无事件序假设。
2. 并发写：不适用——纯渲染条件，无共享可变数据。
3. 切换/生命周期：会话切换时 React 重渲染按新 session 值重估条件；session 未解析（undefined）时 workspace 门关闭、行内变更文件槽不渲染（与原行为一致），待决策 pill 因 sessionId 就绪而渲染——无中间态错位。
4. 作用域：待决策 pill 的数据面（dialogs REST）按 sessionId 隔离，与 workspace 无关，不串台；变更文件 pill 数据面仍按 workspaceId 隔离不变。

## 风险与死路

最大风险：无（渲染条件放宽面极小——待决策 pill 自带三类全空渲染 null 的显隐门）。放弃的方案：给老会话回填 workspace_id（数据修复面大且改变会话归属语义，否决——显隐不应依赖归属字段完整性）。
