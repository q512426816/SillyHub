---
id: task-06
title: 'Wave 4 frontend：双信号提示 + 定时数据上提 + 徽标'
title_zh: 'Wave 4 frontend：双信号提示与徽标'
author: 'qinyi'
created_at: 2026-09-12 11:12:00
priority: P1
depends_on: ['task-03']
blocks: ['task-07']
requirement_ids: ['FR-5.0','FR-5.1','FR-5.2']
decision_ids: ['D-009@v2']
allowed_paths:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/scheduled-messages-bar.tsx
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
target_files:
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/scheduled-messages-bar.tsx
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
goal: >
  design §5.6：①FR-5.0 定时列表查询上提父层（session-panel-page/dialog 两挂载点各接 hook 或抽
  公共 hook；ScheduledMessagesBar 适配——现状隔离在局部 QueryClientProvider
  scheduled-messages-bar.tsx:14-19）；②run-error-item autoRecoverHint 三分支（props 增 pending
  auto_resume 条目集=排队∪定时按 origin 前缀过滤）：瞬时四类+有条目→「上游瞬时故障，已自动
  重发」；quota+reset_at+有定时条目→「额度耗尽，将于 XX:XX（本地时间）自动继续（可在定时消息
  中取消）」；raw 含 silent stream truncation+有条目→「输出流中断，已自动续跑」；其余不注入；
  ③turn-timeline 父级聚合并下发；④scheduled-messages-bar origin=auto_resume:* 条目加「自动
  续跑」徽标 +「系统自动排期，可取消」文案。
implementation: >
  hint 链序对齐 run-error-item.tsx:157 既有注释链（item.hint > fallbackHint > defaultHint）——
  autoRecoverHint 作为 fallbackHint 的动态来源之一接入，实现时按 9-10 daemonRestartedHint 先例
  定位。UI 中文（CLAUDE.md 规则 12）；主题 token 不手写色值（规则 20）。
acceptance: >
  前端 pnpm test（相关套件）+ tsc 绿；三分支 hint×有无条目两态用例 + 徽标渲染用例过；既有
  run-error-item 用例零回归。
constraints: >
  禁止手写 api-types（必须消费 task-03 gen:types 产物）；双信号推导必须查 pending 条目存在性
  （D-009@v2）。
verify: '验收标准见 acceptance 字段'
base_commit: '39d13bd4cbd3c9f198b8e24058951cf548dfa3cd'
head_commit: ''
---

## 验收标准

前端相关套件 + tsc 绿；三分支×有无条目两态 hint 用例、徽标用例过；既有零回归。
