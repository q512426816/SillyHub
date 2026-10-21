---
id: task-01
title: 'Visual layer: six fixes + process semantic labels (already delivered)'
title_zh: '视觉层六条 + 过程语义标签（已完成登记）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09, FR-20]
decision_ids: [D-002@v1, D-003@v1, D-012@v1, D-013@v1, D-015@v2, D-016@v1, D-020@v1, D-021@v1, D-025@v1]
allowed_paths:
  - frontend/src/app/globals.css
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/process-labels.ts
  - frontend/src/components/daemon/attachment-chips.tsx
  - frontend/src/components/daemon/turn-fold.ts
  - frontend/src/components/daemon/__tests__/
  - frontend/src/components/chat/round-divider.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/
  - frontend/src/components/app-shell.tsx
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/workspace-switcher.tsx
  - frontend/src/components/prototype/session-fold-view.tsx
  - frontend/scripts/prototype-build.mjs
target_files:
  - frontend/src/app/globals.css
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/process-labels.ts
  - frontend/src/components/daemon/attachment-chips.tsx
  - frontend/src/components/daemon/turn-fold.ts
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
  - frontend/src/components/daemon/__tests__/turn-time-display.test.tsx
  - frontend/src/components/daemon/__tests__/process-labels.test.ts
  - frontend/src/components/daemon/__tests__/turn-fold.test.ts
  - frontend/src/components/chat/round-divider.tsx
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/app-shell.tsx
  - frontend/src/components/top-bar.tsx
  - frontend/src/components/workspace-switcher.tsx
goal: >
  登记线 A 已交付面（FR-01…FR-09 与 FR-20）：轮元信息一行、正文 15px/1.8/0.65em、过程行 11.5px + muted/80
  + D-025 语义标签、工具行去框改 2px 左规线、过程/答复 14px 分区、轮间只留白、用户气泡降噪、左栏 9px chip。
  本卡不是待做工作——任务已落盘并实测，只作文件覆盖登记与证据索引，execute 见到 tasks.md 的 [x] 即跳过。
implementation:
  - '已落盘（证据：tasks.md「已完成交付面」原 task-01…task-09）：globals.css:815-855 字阶规则块（排在 [data-variant="mobile"] 覆盖块之前）；turn-segment-views.tsx:687（思考行）/ :808（工具行）11.5px + text-muted-foreground/80，去 opacity-75，工具行改 border-l-2 border-border/60 + hover border-l-brand-600；process-labels.ts 固定七类词表；turn-timeline.tsx:1698-1712 轮间去 border-b 只留 pb-7、:2052-2054 助手列 gap-[7px] + [&>.seg-text-body]:mt-[7px]、:1167 turn-meta-detail；round-divider.tsx:69 detail?: string；attachment-chips.tsx:31 tone 双档；session-list-panel.tsx:3460/:3594/:3773/:3821 左栏密度；turn-fold.ts 折叠候选能力（未接线，FR-20）'
  - '物证：prototype-session-final.html（138 正文块 / turn-meta-detail 20 / turn-block 20 / 带线 0 / 缺 pb-7 0）+ proto-final-2026-10-21.png（1600×1000）'
acceptance:
  - 不再重做；任何后续任务不得改动本卡锁死的数值（15px/1.8/0.65em、11.5px、muted/80、border-border/60、14px 分区、pb-7、无边框）
  - '回归判据（供 task-15 复跑）：turn-segment-views.test.tsx 93 例、turn-time-display.test.tsx 8 例、process-labels.test.ts 18 例、turn-fold.test.ts 22 例、attachment-chips.test.tsx 3 例、session-list-panel.test.tsx 119 例全绿'
verify:
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/__tests__/turn-segment-views.test.tsx src/components/daemon/__tests__/turn-time-display.test.tsx src/components/daemon/__tests__/process-labels.test.ts src/components/daemon/__tests__/turn-fold.test.ts
constraints:
  - 只登记不修改；发现与 design 线 A 不符时另开任务，不在此卡顺手改
  - 折叠能力保持「无调用方传 detailLevel」（D-012：整轮折叠不是交付目标）
related_tests:
  - path: frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
    reason: 该文件是线 A 字阶/语义标签的主断言面；task-15 移除 local.yaml 临时豁免后必须以 93/93 绿收口
---
