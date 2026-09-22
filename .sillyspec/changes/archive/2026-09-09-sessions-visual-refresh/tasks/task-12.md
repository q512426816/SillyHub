---
id: task-12
title: 全量回归 + dev server 实拍验收
title_zh: 全量回归与实拍验收
allowed_paths:
  - .sillyspec/changes/2026-09-09-sessions-visual-refresh/
depends_on:
  - task-02
  - task-05
  - task-06
  - task-07
  - task-08
  - task-09
  - task-10
  - task-11
goal: task-01~11 完成后整体验收：测试回归 + 类型/lint + 真实页面实拍（用户最终确认）
implementation: |
  1. 回归：vitest 跑 chat 构件、turn-timeline、turn-segment-views、session-panel、session-list-panel、group-chat、session-input-bar、sessions-portal 全部相关套件；tsc --noEmit；eslint 改动文件 0 error。
  2. 起主仓 dev server（pnpm -C frontend dev，非 Docker 3001 旧构建——ql-20260909-005 环境教训），浏览器实拍：会话页（对话视图/全部视图）× ai-native/dark + blue 会话页一张（R-07 零串紫）+ 首页/工作区各一张（R-01 dark 底色回归面）。
  3. 实拍图存入变更目录 evidence/（截图证据随 verify 归档），呈现给用户做视觉验收确认。
acceptance: 测试全绿 + tsc/eslint 0 错 + 实拍图集齐且用户确认观感
verify: 实拍图 + 测试输出 + 用户确认回复
constraints:
  - 不跑全量测试（CLAUDE.md 规则 0），仅相关套件
  - 实拍必须用主仓 dev server，不用 Docker 旧构建
---

## 说明

本卡产出是 verify 阶段的集成证据（design 判级 integration-critical 的真实证据门控）。
