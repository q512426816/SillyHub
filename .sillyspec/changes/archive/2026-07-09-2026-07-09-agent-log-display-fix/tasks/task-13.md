---
id: task-13
title: 前端 token 单测（cache 维度 / killed 占位 / 历史回看四维）
author: qinyi
created_at: 2026-07-09 06:17:11
priority: P1
depends_on: [task-10, task-11, task-12]
blocks: []
requirement_ids: [FR-06, FR-08, FR-09]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - frontend/src/components/__tests__/agent-run-panel.test.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-dialog.test.tsx
---

## 目标

为 Wave 3 三个前端 token 实现（交互面板四维 / killed 占位 / 历史回看四维）补组件测试，固化行为防回归。对应 FR-06（交互面板）、FR-08（killed 占位）、FR-09（历史回看）。

## 实现步骤

三类组件测试 case（每类按对应实现 task 的验收点拆分）：

### 1. 交互面板 cache 维度（覆盖 task-10 / FR-06）
- onTokens env 带 cache_read_tokens / cache_creation_tokens → SessionTurnView 四维数值渲染
- onTurnCompleted turn 终态 env 透传 cache 维度 → 四维更新
- env 缺 cache 字段 → 对应格占位/0 不崩

### 2. killed/failed 占位（覆盖 task-11 / FR-08）
- agent-run-panel TokenUsageBadge：status=killed + 字段 null → "已中断·未汇总"
- status=failed + 字段 null → 占位
- status=completed + 字段有值 → 正常四维（不误占位）
- runtime-session-dialog 历史命中 killed run → 同占位口径

### 3. 历史回看四维（覆盖 task-12 / FR-09）
- runtime-session-dialog SessionHistoryView：run 字段齐全 → 四维数值
- 复用 format-token 格式（与主面板一致）
- 历史 killed run → 占位

### 共用约定
- 测试文件就近 `__tests__/` 目录（执行前确认现有测试目录结构，避免与既有 test 文件命名冲突）
- 若被测组件用 next/dynamic ssr:false（如 MarkdownText），测试顶部 vi.mock 成纯文本渲染（参照 frontend-markdown-text-jsdom-null 经验）

## 测试

本 task 即测试本身，无额外测试。

## 验收标准

- AC-06：组件测试交互面板 token 四维显示
- AC-08：组件测试 killed/failed + NULL → "已中断·未汇总"占位
- AC-09：组件测试历史回看 token 四维
- AC-11：全量 frontend vitest 全绿，无回归

## 依赖说明

- depends_on task-10/11/12：三个被测实现须先落地，否则测试无对象
- 注：本 task 是 Wave 3 收口验证，跑完后触发 AC-11 全量回归
