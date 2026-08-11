# Decisions — 2026-08-11-mcp-token-management-ui

---
author: qinyi
created_at: 2026-08-11 14:50:00
---

## D-001@v1: MCP 令牌 tab 的 viewer 可见性

- type: boundary / architecture
- priority: P1
- status: accepted
- source: design-grill (C9)
- question: `workspace-tabs.tsx` 是静态 `as const` 数组无 tab 级权限字段先例，且客户端无 workspace-scoped WRITE 信号源（MemberBindingView 仅 daemon_id/root_path/shared；`/api/auth/me` 权限是 platform∪all-workspace 并集，非本 workspace scoped）。MCP 令牌 tab 对 viewer（只读成员）如何处理？
- answer: tab 对所有 bound 成员可见，**不按权限隐藏**；viewer 点入由服务端 `WORKSPACE_WRITE` 403 兜底，前端展示"无权限"空态（方案③）。
- alternatives_rejected:
  - ② 改 `WorkspaceBindingGuard` 返回 role，只给 WRITE 成员显示 tab（UX 干净但多改权限组件 + 改 guard 契约，影响面大）
  - ① 新增暴露 workspace-scoped role/permission 的 API（最重，为一个 tab 不值得）
- normalized_requirement: `workspace-tabs.tsx` 加「MCP 令牌」tab 项（无权限字段，静态数组加一项即可）；`page.tsx` 捕获 GET 403 展示"无权限"空态，不泄漏 token 存在性。
- impacts: [workspace-tabs.tsx, mcp-tokens/page.tsx 错误态]
- evidence: workspace-tabs.tsx 静态 as const 数组、router.py:56 WorkspaceWriter=require_permission(WORKSPACE_WRITE)、workspace-binding-guard.tsx:29-53 只验 binding 不暴露 permission
