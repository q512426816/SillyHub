---
id: task-04
title: frontend 流式 import 读 SSE + 进度 UI + done 刷新变更中心（覆盖：FR-07）
author: WhaleFall
created_at: 2026-07-01 13:04:17
priority: P0
depends_on: [task-03]
blocks: [task-05]
requirement_ids: [FR-07]
decision_ids: [D-001]
allowed_paths:
  - frontend/src/lib/spec-workspaces.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
goal: >
  importSpecWorkspace 绕过 apiFetch 用原生 fetch + ReadableStream + TextDecoder
  解析 SSE 阶段事件，import 按钮显示阶段进度，done 后刷新 spec_ws + 变更中心数据。

implementation:
  - spec-workspaces.ts importSpecWorkspace 改：原生 fetch(POST, headers 含
    Accept:text/event-stream + Authorization:Bearer)，读 response.body.getReader()，
    TextDecoder 逐 chunk 按 "event:X\ndata:Y\n\n" 切分，回调 onProgress(phase, data)
  - page.tsx handleImport 改用新 importSpecWorkspace(workspaceId, onProgress)，
    onProgress 更新 importPhase 状态（打包中/落盘中/解析文档(N)/解析变更(N)）；
    done 事件 setSpecWs + 触发变更中心数据重拉（listChanges active + archive）；
    error 事件 setPageError(message)
  - import 按钮 importing 中显示阶段文本（复用现有 PageContainer/Badge/Button，
    无新原型、不加新依赖）

acceptance:
  - 点击导入显示实时阶段进度（非空白转圈）
  - done 后变更中心立即显示 changes（无需手动刷新）
  - error 时显示错误 message

verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm lint
  - cd frontend && pnpm test（如有相关测试）

constraints:
  - 不复用 apiFetch（它 JSON parse，SSE 需流式）
  - 鉴权头与 apiFetch 一致（Authorization: Bearer + x-request-id）
  - 进度 UI 复用现有组件，不加新依赖
  - done 后必须刷新变更中心（FR-07 关键）
