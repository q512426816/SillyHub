---
id: task-07
title: 'R-03: capture blue/dark theme and narrow-viewport visual evidence'
title_zh: 'R-03 三主题与窄屏观感证据'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P2
depends_on: []
blocks: []
requirement_ids: [FR-09]
decision_ids: [D-015@v2, D-019@v1]
allowed_paths:
  - .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-theme-blue-2026-10-21.png
  - .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-theme-dark-2026-10-21.png
  - .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-narrow-768-2026-10-21.png
target_files: []
goal: >
  补齐 R-03 登记的证据缺口：现有观感物证只有 ai-native 浅色 + 1600×1000 单视口
  （proto-final-2026-10-21.png）。本卡补 blue / dark 两主题与窄屏（≤768px）截图，并逐主题核对正文/muted 对比度，
  让「三主题只走语义 token」这条结论有可指认的物证而非仅有规则层保证。
implementation:
  - '起 dev 路由（frontend/src/app/proto/session-redesign/，`cd frontend && pnpm dev`）后用既有导出/截图手段取三态：①`html[data-theme="blue"]` 1600×1000；②`html[data-theme="dark"]` 1600×1000；③窄屏 768×1024（对应 [data-variant="mobile"] 生效面）'
  - '命名与落盘：proto-theme-blue-2026-10-21.png / proto-theme-dark-2026-10-21.png / proto-narrow-768-2026-10-21.png，写入本变更目录；不改任何源码'
  - '对比度核对：对正文 15px 与过程行 11.5px + muted/80 取实际渲染色值，按 WCAG 相对亮度公式算对比度，正文 ≥4.5:1、muted ≥3:1；不达标即记为风险并给出需回到 /90 的结论（R-01 处置路径），不得只改样式不改断言'
acceptance:
  - 变更目录新增 3 个截图文件，且每张记录主题、视口尺寸、时间
  - 对比度核对结论逐主题写入本卡 acceptance 追加行（三行：ai-native / blue / dark），并注明是否过 4.5:1 / 3:1
  - 窄屏截图里桌面字阶规则不生效（正文回到 mobile 档），说明 globals.css 的块序约束仍然成立
verify:
  - Get-ChildItem .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-theme-*.png, .sillyspec/changes/2026-10-20-session-page-dsh-alignment/proto-narrow-*.png | Measure-Object | Select-Object -ExpandProperty Count
constraints:
  - 只补证据，不改源码/不改样式：任何观感不达标一律登记，不在本卡顺手调参
  - 截图必须是 dev 路由真实渲染（D-017/D-018），禁止手绘或 SSR 抓稿
  - 本变更不承诺窄屏观感达标（R-03 原文），截图只作现状留档
related_tests: []
---
