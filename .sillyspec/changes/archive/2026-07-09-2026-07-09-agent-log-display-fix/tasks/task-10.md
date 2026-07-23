---
id: task-10
title: interactive-session-panel SessionTurnView 补 cache_read/cache_creation 四维
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P1
depends_on: []
blocks: [task-13]
requirement_ids: [FR-06]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
---

## 目标

交互式会话面板（路径 B：实时 SessionTurnView）token 显示从输入/输出两维补齐到四维——新增 cache_read / cache_creation。当前 onTokens / onTurnCompleted 回调未读 env.cache_read_tokens / cache_creation_tokens，致 cache 维度在交互面板不可见。

## 实现步骤

1. SessionTurnView（约 72-74）state 扩展：新增 cacheRead、cacheCreation 两个 state 字段（与现有 input/output 同层）
2. onTokens 回调（约 204-225）补读：env.cache_read_tokens → setCacheRead；env.cache_creation_tokens → setCacheCreation
3. onTurnCompleted 回调（同区）补读 turn 终态 env 的 cache_read_tokens / cache_creation_tokens 并 set
4. 渲染层：token 四维面板补 cache_read / cache_creation 两格（口径与 agent-run-panel 主面板一致，复用 format-token.ts）
5. 若 cache_creation 在 task-09 B 分支下为 null/0，沿用 format-token 占位（"—/未知"），不另写占位逻辑

## 测试

- frontend vitest：构造 onTokens env 带 cache_read_tokens/cache_creation_tokens → SessionTurnView 渲染四维数值
- 缺失场景：env 不含 cache 字段 → 对应格显示占位/0（不崩）

## 验收标准

- AC-06：组件测试交互面板 token 四维显示（输入/输出/缓存读/缓存写）

## 依赖说明

- 无 depends_on（不阻塞 task-09，task-09 落 daemon/format-token，本 task 只读 env 已透传字段）
- blocks task-13：前端 token 单测覆盖交互面板 cache 维度 case
- 注：cache 字段名以 backend env 实际透传为准（cache_read_tokens / cache_creation_tokens），执行前 grep interactive-session-panel env 类型确认
