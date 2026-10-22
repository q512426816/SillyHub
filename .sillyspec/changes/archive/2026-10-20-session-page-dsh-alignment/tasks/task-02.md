---
id: task-02
title: 'Trajectory lane timeline, zoom/pan and dev route (already delivered)'
title_zh: '轨迹档 1：泳道时间轴 / 缩放平移 / 账本 / dev 路由（已完成登记）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-10, FR-11, FR-12]
decision_ids: [D-022@v1, D-024@v1, D-026@v1]
allowed_paths:
  - frontend/src/components/daemon/trajectory/
  - frontend/src/app/proto/session-trajectory/
target_files:
  - frontend/src/components/daemon/trajectory/build-trajectory.ts
  - frontend/src/components/daemon/trajectory/zoom.ts
  - frontend/src/components/daemon/trajectory/trajectory-timeline.tsx
  - frontend/src/components/daemon/trajectory/trajectory-view.tsx
  - frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts
  - frontend/src/components/daemon/trajectory/__tests__/zoom.test.ts
  - frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
  - frontend/src/app/proto/session-trajectory/page.tsx
  - frontend/src/app/proto/session-trajectory/trajectory-proto-view.tsx
goal: >
  登记线 B 已交付面（FR-10/11/12）：纯函数装配器 + 三泳道共享绝对时间轴（缩放/平移/刷子/命中带）+ role="grid"
  账本 + 320px 检查器 + dev 路由 SSR 读盘。本卡不是待做工作，只作覆盖登记与证据索引。
implementation:
  - '已落盘（证据：tasks.md「已完成交付面」原 task-10…task-12）：build-trajectory.ts（946 行，按 run 分组/同毫秒 agent_event.seq 稳定排序/tool_use↔tool_result 按 call_id 配对/depth·parentCallId 透传/协议前缀剥除/800 字截断 + lanes·coverage 派生）；zoom.ts（272 行，zoomAt/panView/clampView/tickTimes/pickSpanAt，MIN_VIEW_SPAN_MS=60s、ZOOM_STEP=1.15、HIT_BAND_PX=6）；trajectory-timeline.tsx（738 行，非 passive wheel、拖拽平移、双击/按钮重置、10px 刷子、6px 命中带最近中心裁决、视野派生刻度）；trajectory-view.tsx（539 行，轴与账本同列叠放右缘对齐 + 320px 检查器 + content-visibility:auto）；proto route 用 loadStagedSessionExport() 读 frontend/.proto-staging/session-export.json（dynamic="force-dynamic"）'
  - '物证：prototype-session-trajectory.html（856 行账本 / trajectory-lane-label 3 / trajectory-bar 618 / role="grid" 1 / 1 段 vanilla shim）；轴右缘与账本盒右缘同为 1280px，Δ=0.00px（1600×1000，改前 308px）'
acceptance:
  - 不再重做；任何后续任务不得改动三泳道/缩放/轴对齐行为，也不得把「时间概览（每轮一行）」加回来（D-024 判定为错误形态）
  - '回归判据（供 task-15 复跑）：build-trajectory 31 例、zoom 18 例、trajectory-timeline 7 例全绿'
  - '模型条口径保持现状直到 task-12 接入 timing：整段非工具空档 + 含思考/答复行、与工具零重叠、modelMs+toolMs ≤ windowMs，UI 必须标注「近似」'
verify:
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/trajectory/__tests__/build-trajectory.test.ts src/components/daemon/trajectory/__tests__/zoom.test.ts src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
constraints:
  - 只登记不修改；模型条口径变更属 task-12，不得在此卡预改
  - 轨迹视图保持零 fetch / 零 store / 零 context（数据由 props 注入，FR-11）
related_tests:
  - path: frontend/src/components/daemon/trajectory/__tests__/trajectory-timeline.test.tsx
    reason: task-12 会给泳道组件加「近似/真实」标注，须在该卡同步该测试断言，避免此处 7 例失效
---
