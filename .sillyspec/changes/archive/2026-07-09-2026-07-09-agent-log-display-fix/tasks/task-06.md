---
id: task-06
title: classifyLog 补 [TOOL_USE] 降级 + NOISE_PREFIXES/isThinkingContent 改折叠分类
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P0
depends_on: []
blocks: [task-07, task-08]
requirement_ids: [FR-10, FR-05]
decision_ids: [D-002@v2, D-006@v1]
allowed_paths:
  - frontend/src/components/agent-log/normalize.ts
---

## 目标

normalize.ts 三处改造：(1) classifyLog 把 `[TOOL_USE]` stdout 降级归 tool_call 分类（兼容 daemon 历史降级路径）；(2) NOISE_PREFIXES filter 不再删除，改标记折叠类；(3) isThinkingContent 把 `[SYSTEM` 归 thinking 合并吞掉的逻辑改为折叠摘要分类。D-002@v2 核心——**必须同时改两处**，否则只覆盖 thinking_tokens 一种，多数 SYSTEM 仍被 thinking 合并吞。

## 实现步骤

1. 定位 `frontend/src/components/agent-log/normalize.ts:334-358`（classifyLog）+ `:374`（NOISE_PREFIXES filter）+ `:619-640`（isThinkingContent / isThinkingOnly）。
2. classifyLog 补 `[TOOL_USE]` stdout → tool_call 分支（降级，新日志无此行但旧日志有）。
3. NOISE_PREFIXES filter 改为标记折叠类（不删 `[SYSTEM:thinking_tokens]`，改折叠标记）。
4. isThinkingContent / isThinkingOnly 把 `[SYSTEM` 开头归 thinking 合并块的逻辑改为折叠摘要分类（避免吞掉其余 `[SYSTEM:*]`）。
5. 产出折叠类标签（如"思考 token 计数 · N 条"/"系统信息 · N 条"）+ foldedSummary/foldedDetail 结构供 task-07 渲染。

## 测试

见 task-08：折叠展开交互 + [TOOL_USE] 降级归 tool_call 单测。

## 验收标准

- AC-05：组件测试 [SYSTEM:*]/[THINKING] 折叠摘要可展开（不删/不吞）
- AC-10：单测 classifyLog [TOOL_USE] stdout → tool_call（降级）

## 依赖说明

- 无 depends_on（纯 normalize 内部改造）。
- D-002@v2 关键：NOISE_PREFIXES（line 374）与 isThinkingContent（619-640）两处同改——仅改 filter 只折叠 thinking_tokens 一种，多数 [SYSTEM:*] 走 thinking 合并被吞。
