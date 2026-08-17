---
id: task-05
title: redirect-to-session-after-scan
title_zh: 配置卡扫描成功后跳转会话页并移除内嵌运行面板
author: qinyi
created_at: 2026-08-17 14:10:00
priority: P0
depends_on: [task-04]
blocks: []
requirement_ids: [FR-03]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
  - frontend/src/components/workspace-config-card.test.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
provides: 无
expects_from:
  task-04:
    - contract: ScanGenerateResponse
      needs: [session_id]
goal: >
  配置卡「扫描」派发成功后跳转到工作区会话页并深链新建的 scan 会话，同时移除内嵌运行面板，覆盖 FR-03 与 D-002@v1。
implementation:
  - handleScan 成功后改用 next/navigation 的 useRouter，router.push 跳转 /workspaces/{workspaceId}/sessions，session_id 非空时追加 session 查询参数深链，为 null 时仅跳转不深链
  - 删除内嵌 AgentRunPanel 相关状态逻辑，包括 setActiveScanRunId、scanStatus、closeScanPanel、handleScanRunDone 及 busyReason 中 activeScanRunId 分支
  - 删除 JSX 内嵌扫描运行面板区块与重扫提示、scanError 展示，保留 409 确认重扫与 owner 门禁，清理不再引用的 import
acceptance:
  - 扫描成功后调用 router.push 且路径含 session 参数
  - session_id 为 null 时路径不含深链参数
  - 移除内嵌面板后 UI 不再渲染 AgentRunPanel，相关状态回调已删除，扫描用例全部通过
verify:
  - cd frontend 后 pnpm exec vitest run workspace-config-card 与 page.test 相关用例，再 pnpm exec tsc --noEmit
constraints:
  - 只修改 allowed_paths 列出的三个文件，不修改其它源码
  - 使用 next/navigation useRouter，单测需 mock useRouter，session_id 为 null 时不得拼接深链参数
  - 409 确认重扫逻辑与 owner 门禁保持不变
related_tests:
  - workspace-config-card.test.tsx 扫描用例由断言内嵌面板与 scanStatus 改为断言 router.push 跳转
  - page.test.tsx 三处 scanGenerate mock 补 session_id 并补 router push 断言
---
