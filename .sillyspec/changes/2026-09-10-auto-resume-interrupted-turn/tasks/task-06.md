---
id: task-06
title: 'Wave 6 前端：失败卡 hint 注入 + 续跑轮徽标'
title_zh: 'Wave 6 前端：失败卡 hint 注入 + 续跑轮徽标'
author: 'qinyi'
created_at: 2026-09-10 09:30:00
priority: P1
depends_on: ['task-03','task-05']
blocks: ['task-07']
requirement_ids: ['FR-07']
decision_ids: ['D-002@v2']
allowed_paths:
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
  - frontend/src/components/agent-log/__tests__/run-error-item.test.tsx
  - frontend/src/components/daemon/__tests__/
target_files:
  - frontend/src/components/agent-log/run-error-item.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/session-panel/page-helpers.tsx
goal: >
  daemon_restarted 不在前端 8 类错误映射（无现 hint）——hint 由父级（turn-timeline/session-panel 持有 session.config）按开关状态 props 注入 run-error-item：开=「服务重启中断本轮，会话恢复后将自动续跑」；关=「服务重启中断本轮，会话已保留，可手动重发」。turn-timeline 识别 run metadata.auto_resume_of（api-types 字段）渲染「自动续跑」徽标（对齐既有轮次徽标样式惯例）——数据装配经 session-panel/page-helpers.tsx 的 enrichDisplayTurns 中继补 autoResumeOf 注入（sender/whoLine 同款先例，plan 审查 P1-2）；测试落 daemon/__tests__（既有 turn-timeline 测试目录惯例）。
implementation: >
  daemon_restarted 不在前端 8 类错误映射（无现 hint）——hint 由父级（turn-timeline/session-panel 持有 session.config）按开关状态 props 注入 run-error-item：开=「服务重启中断本轮，会话恢复后将自动续跑」；关=「服务重启中断本轮，会话已保留，可手动重发」。turn-timeline 识别 run metadata.auto_resume_of（api-types 字段）渲染「自动续跑」徽标（对齐既有轮次徽标样式惯例）——数据装配经 session-panel/page-helpers.tsx 的 enrichDisplayTurns 中继补 autoResumeOf 注入（sender/whoLine 同款先例，plan 审查 P1-2）；测试落 daemon/__tests__（既有 turn-timeline 测试目录惯例）。
acceptance: >
  hint 两态用例 + 无 config 回退中性文案；徽标有标记渲染/无标记零回归；既有 run-error-item/turn-timeline 测试零回归；tsc 0。
constraints: >
  见 design.md 对应决策与 NFR；禁止越 allowed_paths 改文件；先例引用以行号锚定；既有测试零回归（NFR-01）。
verify: '验收标准见 acceptance 字段'
base_commit: '76c15a7884ce9cbba09b429733e37b7382bb5377'
head_commit: 'ba57735d3ae4d568b08c8ae4f103d75bc8dfffb0'
---


## 验收标准

hint 两态用例 + 无 config 回退中性文案；徽标有标记渲染/无标记零回归；既有 run-error-item/turn-timeline 测试零回归；tsc 0。
