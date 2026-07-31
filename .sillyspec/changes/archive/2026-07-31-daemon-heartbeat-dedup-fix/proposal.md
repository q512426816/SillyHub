---
author: WhaleFall
created_at: 2026-07-30T15:51:14
---

# 提案（Proposal）— daemon 心跳卡死 + 回复重复修复

## 动机
sillyhub-daemon 两个核心 bug 阻塞平台会话功能：
1. **心跳卡死**：daemon 跑约 2 分钟事件循环冻死、backend 标 offline，daemon 起不来，无法跑会话（阻塞一切验证）。
2. **回复重复**：agent 回复「半截+全文」双发（实测 7fb9227d #35），会话内容重复。

## 方案概述（方案 A：照搬 thinking 全套）
- **卡死**：`PolicyCache.set` 去 `resolveRealPath` 统一路径归一口径 + `isPathUnderAnyRoot` 补 realpath（下沉到判定）+ `_syncAllowedRoots` 短路。消除每拍同步 stat 风暴。
- **重复**：照搬 thinking 成熟机制 —— daemon emit `[ASSISTANT_OVERRIDE]` + backend `flushed_partials` 扩 assistant 删 partial。
- **范围**：sillyhub-daemon（卡死 + 重复 daemon 侧）+ backend（重复 backend 侧）。

## 不在范围内（Non-Goals）
- 不改前端（格式已 ql-20260730-004 修）
- 不改 agent 行为
- 不改 thinking 现有机制（只照搬到 assistant）
- 不改 backend lease/session/agent_run 状态机
- 不重写 WS/HTTP 心跳（已确认无问题）

## 规模
**large**（多文件 daemon+backend + sandbox 路径判定安全相关 + 两个独立 bug）。走 plan 阶段。
