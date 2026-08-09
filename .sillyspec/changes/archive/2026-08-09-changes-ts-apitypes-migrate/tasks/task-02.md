---
id: task-02
title: 调用方 drift guard（typecheck 暴露点补 nullable guard）
title_zh: 调用方 drift guard（warnings/current_stage/TransitionDispatchResponse 字段补 ?. / ??）
author: qinyi
created_at: 2026-08-09 08:48:57
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
low_risk: true
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/tasks/page.tsx
provides: []
expects_from: []
goal: >
  修复 task-01 类型迁移后 typecheck 暴露的调用方断裂（required→optional 字段补 ?. / ?? guard），
  不改业务逻辑。重点：changes/page.tsx:188 setWarnings(resp.warnings) 补 ?? []。
implementation:
  - cd frontend && pnpm typecheck 收集 task-01 引入的所有调用方 error 清单
  - changes/page.tsx:188 setWarnings(resp.warnings) → setWarnings(resp.warnings ?? [])（resp 是 ChangeReparseResponse，warnings 迁后变 optional，setWarnings 不接受 undefined）
  - ⚠️ tasks/page.tsx 的 reparseResult 是 TaskReparseResponse（@/lib/tasks，warnings required）不受影响，勿误改
  - TransitionDispatchResponse 字段（agent_run_id/stage/reason/mission_id/mode）迁后变 optional，按 typecheck 暴露点补 ?.（主要 changes/[cid]/page.tsx，大多已 ??/truthy 防御）
  - current_stage（ChangeSummary/ChangeRead 迁后变 optional）未防御点补 ?. / ??（23 处大多已防御，仅补 typecheck 暴露的）
  - 复跑 typecheck 至 0 error
acceptance:
  - cd frontend && pnpm typecheck 0 error
  - changes/page.tsx setWarnings 带 ?? [] guard
  - 所有 task-01 引入的 typecheck error 均已修复（补 guard，非绕过）
verify:
  - cd frontend && pnpm typecheck（必须 0 error）
  - cd frontend && pnpm test（vitest run 全过 —— guard 不破坏既有测试）
constraints:
  - 仅补 nullable guard（?. / ??），不改业务逻辑
  - 不为躲 typecheck 改回手写类型或 as any 断言（规则 20）
  - typecheck 暴露 allowed_paths 外文件 → 停下反馈（扩 allowed_paths 或 design 补文件），不越权改
related_tests: []
---
