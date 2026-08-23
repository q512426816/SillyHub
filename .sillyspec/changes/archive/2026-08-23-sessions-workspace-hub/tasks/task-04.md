---
id: task-04
title: 'pre-session-picker-two-step-popover'
title_zh: '两步轻选择浮层（在线机器→智能体）'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-107@v1]
allowed_paths:
  - frontend/src/components/sessions/pre-session-picker.tsx
  - frontend/src/components/sessions/__tests__/
goal: >
  全部态新建的机器/智能体两步轻选择浮层：两步即达非配置表单（D-107），选完即回调关闭。
implementation:
  - 纯展示受控组件：props { open, machines（父层注入）, onCancel, onPick(runtimeId) }
  - 第一步仅在线机器（机器卡样式语义复用：在线徽标/心跳）；第二步该机器 provider∈{claude,codex} 白名单，默认 Claude Code 高亮
  - 选完智能体立即回调关闭，无确认按钮；原型 prototype v2 .picker 视觉对照（亮色主题）
  - 空态：无在线机器/无可用智能体引导文案
acceptance:
  - 第一步仅列在线机器；第二步仅列 claude/codex 且默认高亮 Claude Code
  - 选完即 onPick(runtimeId) 关闭无第三步
  - 取消/遮罩点击关闭不清父层状态
verify:
  - pnpm exec vitest run src/components/sessions/__tests__/pre-session-picker.test.tsx
constraints:
  - 不自建数据请求（machines 由 props 注入）；新文件 kebab-case
---

# task-04 补充说明
门户接线（何时打开/上下文合成）归 task-06。
