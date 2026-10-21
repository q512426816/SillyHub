---
id: task-03
title: 'Prototype pipeline + file-changes card form prototype (already delivered)'
title_zh: '原型管线 + 文件变更卡形态原型（已完成登记）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-17, FR-18, FR-19]
decision_ids: [D-010@v1, D-014@v1, D-017@v1, D-018@v1]
allowed_paths:
  - frontend/src/app/proto/session-redesign/
  - frontend/src/app/proto/session-file-changes/
  - frontend/src/components/daemon/file-changes/file-changes-card.tsx
  - frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  - frontend/e2e/proto-file-card.spec.ts
  - frontend/scripts/export-hydrated.mjs
  - frontend/prototype-dist/
target_files:
  - frontend/src/app/proto/session-redesign/page.tsx
  - frontend/src/app/proto/session-redesign/view.tsx
  - frontend/src/app/proto/session-redesign/proto-fixtures.ts
  - frontend/src/app/proto/session-redesign/staged-session-export.ts
  - frontend/src/app/proto/session-redesign/types.ts
  - frontend/src/app/proto/session-redesign/session-redesign.module.css
  - frontend/src/app/proto/session-file-changes/page.tsx
  - frontend/src/components/daemon/file-changes/file-changes-card.tsx
  - frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
  - frontend/e2e/proto-file-card.spec.ts
  - frontend/scripts/export-hydrated.mjs
goal: >
  登记线「原型管线」已交付面（FR-17/18/19）：dev 预览路由渲染真实组件 + 水合后 DOM 导出脚本自带机械校验 +
  文件变更卡的**形态原型**（桩数据，只证形态不证数据链路）。本卡不是待做工作，只作覆盖登记与证据索引。
implementation:
  - '已落盘：frontend/src/app/proto/session-redesign/（真实 AppShell / SessionListPanel / TurnTimeline / CtxUsageBar / SessionInputBar，fixtures 打桩，SSR 读 .proto-staging）；export-hydrated.mjs（playwright 水合 → cssRules → outerHTML → 剥 script/link → 单 style → 机械校验；expectedScriptCount :864-870、problems 断言 :909-951、先失败后落盘 :953-957、顶层 catch :1170-1175）；file-changes-card.tsx（props only，折叠 28px / 展开 24px / 限高 240px / truncated 破折号 / sharedWorkspace 提示）+ /proto/session-file-changes 四态路由 + Playwright 1 例 + 8 例单测'
  - '物证：prototype-session-final.html（138 正文块 / template 0 / 1 段 vanilla shim / link 0 / style 1）；prototype-file-changes.html（561,812 字节 / 1 段 shim / 7 处 file-changes-card）；proto-file-card-2026-10-21.png'
acceptance:
  - 不再重做；task-05 引用本卡的导出脚本做回归（改 CSS 后重跑导出，正文块仍为 138）
  - '本卡只证形态：卡片的数据链路（daemon → backend → 前端）由 task-08/09/11 交付，禁止把桩数据原型当功能完成证据（R-11）'
  - '回归判据：file-changes-card.test.tsx 8 例全绿；导出脚本对 prototype-session-final.html 的机械校验通过'
verify:
  - cd frontend && node node_modules/vitest/vitest.mjs run src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
constraints:
  - 导出产物禁止手改（改源码必须重跑 export-hydrated.mjs，D-018）
  - /proto/* 与 frontend/.proto-staging/ 保持 dev-only：禁进导航、禁被生产页面引用（FR-19）
related_tests:
  - path: frontend/src/components/daemon/file-changes/__tests__/file-changes-card.test.tsx
    reason: task-11 会给同一组件加 capability="tool_only" 降级形态，该 8 例中的折叠/断言行必须同步扩展而不是失效
---
