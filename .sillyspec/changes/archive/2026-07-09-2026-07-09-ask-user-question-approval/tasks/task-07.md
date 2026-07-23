---
id: task-07
title: session-permission-panel 渲染分流（dialog_kind）+ SSE/查询去重
title_zh: 审批面板按对话类型分流渲染
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-05]
blocks: [task-09]
allowed_paths:
  - frontend/src/components/permissions/session-permission-panel.tsx
provides:
  fields: ["dialog_kind render split", "request_id merge"]
expects_from:
  task-05:
    needs: ["SessionPermissionRequest(dialog_kind)"]
---

# task-07 · SessionPermissionPanel 渲染分流 + SSE/查询去重

## 目标

`/approvals` 审批中心的 `SessionPermissionPanel`（断点②，design §3.2）渲染卡片时按
`dialog_kind` 分流：有 `dialog_kind` → `AskUserDialogCard`（结构化问答）；无 →
`PermissionApprovalCard`（allow/deny）。同时把 SSE 实时推入与查询端点
（task-06 `GET /workspaces/{id}/dialogs`）结果按 `request_id` 合并——查询回填的来源字段
（workspace_name/session_type/run_summary）覆盖 SSE 占位「加载中」（design C4）。

依据：design §4.2 渲染分流 + §4.3 聚合兜底 + §5.3 生命周期契约（SSE 不含来源字段，
查询带全字段）。对齐 `interactive-session-panel:251` 已验证的分流模式。

## 实现

1. **渲染分流**（session-permission-panel.tsx:110-121）：
   ```tsx
   cards.map((req) => req.dialog_kind
     ? <AskUserDialogCard key={req.request_id} request={req}
         onResolved={(id) => setCards(prev => prev.filter(c => c.request_id !== id))} />
     : <PermissionApprovalCard key={req.request_id} request={req}
         onResolved={(id) => setCards(prev => prev.filter(c => c.request_id !== id))} />)
   ```
   - `import { AskUserDialogCard } from "@/components/ask-user-dialog-card"`。

2. **查询与 SSE 合并**（C4 + 现有去重 :57）：
   - 查询结果（task-06 注入的 props 或 hook）与 SSE 推入按 `request_id` 幂等合并：
     同 id 已存在 → **查询字段覆盖** SSE 占位（`session_type`/`run_summary` 由「加载中」
     回填为真实值）；不存在 → 追加。
   - SSE 推入保留现有增量逻辑（`prev.some(c => c.request_id === req.request_id) ? prev : [...prev, req]`）。
   - permission_resolved（`decision` 字段）按 `request_id` 移除，逻辑不动。

3. 不动 `AskUserDialogCard`/`PermissionApprovalCard`（零改动复用，design §3.3）。

## 验收标准

- AC-1：scan/stage 触发 AskUserQuestion → 渲染 `AskUserDialogCard`（问答 header/question/options）。
- AC-5：新 AskUserQuestion SSE 实时弹（<2s）；来源字段先占位「加载中」，查询刷新后回填正常。
- AC-6：无 `dialog_kind` 的普通审批仍渲染 `PermissionApprovalCard`（allow/deny）。

## 验证

`cd frontend && pnpm typecheck && pnpm test`（新增/调整渲染分流 + 去重合并单测）。

## 约束

- 复用 `AskUserDialogCard`/`PermissionApprovalCard`，零改动（design §3.3 / D-008 风格）。
- C4：查询回填字段覆盖 SSE 占位，不能反向（SSE 覆盖查询的真实字段）。
- 不破坏现有 `request_id` 去重与 permission_resolved 移除逻辑。
