---
id: task-05
title: lib/daemon.ts 扩展（SessionPermissionRequest 来源字段 + listWorkspaceDialogs + parse 兼容）
title_zh: 前端 daemon lib 类型与查询封装
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-03]
blocks: [task-06, task-07, task-08]
allowed_paths:
  - frontend/src/lib/daemon.ts
provides:
  fields: [listWorkspaceDialogs, "SessionPermissionRequest(extended)", "parseSessionPermissionEvent(extended)"]
expects_from:
  task-03:
    needs: ["WorkspaceDialogRead response shape"]
---

# task-05 · lib/daemon.ts 扩展（来源字段 + listWorkspaceDialogs + parse 兼容）

## 目标
为审批中心提供来源上下文的前端类型与查询封装：
1. `SessionPermissionRequest`（daemon.ts:608）新增可选来源字段（workspace_name / session_type / run_summary），全 `?` 兼容 SSE 缺省（design §4.4 C4）。
2. 新增 `listWorkspaceDialogs(workspaceId)` 调 `GET /api/workspaces/{id}/dialogs`（task-03 端点），返回带来源上下文的 `SessionPermissionRequest[]`。
3. `parseSessionPermissionEvent`（daemon.ts:695）不强解析来源字段——SSE 路径 backend 不发这些字段（design §5.3），保持缺省 undefined，由查询路回填。

## 依据
- design.md §4.4（SessionPermissionRequest 扩展 C4：SSE 路缺省、查询路齐全、两路按 request_id 合并）。
- design.md §5.2（新增/扩展：SessionPermissionRequest 加可选来源字段；新 `GET /api/workspaces/{id}/dialogs` → WorkspaceDialogRead[]）。
- design.md §5.3 生命周期契约表：permission_request SSE 仅含 session_id/run_id/request_id/tool_name/dialog_kind/dialog_payload，**不含**来源字段。
- 现有代码：`SessionPermissionRequest`（daemon.ts:608-643，已含 dialog_kind/dialog_payload 可选字段）；`parseSessionPermissionEvent`（daemon.ts:695-733）；`respondSessionPermission`（daemon.ts:658）；`listWorkspaceAgentSessions`（workspace 级 session 查询先例，复用 apiFetch 模式）。

## 实现
1. **类型扩展（daemon.ts:608 `SessionPermissionRequest`）**——在现有字段后追加三个可选字段，不动任何必填字段，保证向后兼容：
   ```ts
   /** 来源上下文（design §4.4 C4）：查询路齐全，SSE 路缺省 undefined。 */
   workspace_name?: string;
   /** scan / chat / stage（design D-003，backend 推导）。SSE 缺省。 */
   session_type?: "scan" | "chat" | "stage";
   /** 任务 prompt 派生的上下文一句话（design D-003，可空→前端占位）。SSE 缺省。 */
   run_summary?: string | null;
   ```
2. **新增 `listWorkspaceDialogs`**——放 `fetchPendingDialogs`（daemon.ts:745）之后或 `listWorkspaceAgentSessions` 附近，复用 `apiFetch`：
   ```ts
   /**
    * GET /api/workspaces/{id}/dialogs — workspace 维度 pending AskUserQuestion
    * 对话查询（task-03 端点，design §4.1）。返回 SessionPermissionRequest[]，
    * 含来源上下文（workspace_name/session_type/run_summary），作为 SSE 实时增量
    * 的数据库兜底（刷新不丢，design FR-5）。父组件按 request_id 与 SSE 合并，
    * 查询回填字段覆盖 SSE 占位（design §4.4 C4）。
    */
   export async function listWorkspaceDialogs(
     workspaceId: string,
   ): Promise<SessionPermissionRequest[]> {
     return apiFetch<SessionPermissionRequest[]>(
       `/api/workspaces/${encodeURIComponent(workspaceId)}/dialogs`,
     );
   }
   ```
   - 响应类型用 `SessionPermissionRequest[]`（task-03 的 `WorkspaceDialogRead` 字段是其超集，结构兼容；SSE 同构便于父组件直接合并）。
3. **`parseSessionPermissionEvent`（daemon.ts:695）保持现状不强解析来源**——SSE payload 无 workspace_name/session_type/run_summary（design §5.3），这些字段不在构造的 `req` 上赋值即自然 `undefined`，符合 C4「SSE 路占位」。仅确认不引入反向强解析逻辑（不把 undefined 写成空串）。

## 验收标准
- `SessionPermissionRequest` 新增三字段全 `?` 可选，现有引用（PermissionApprovalCard / AskUserDialogCard / session-permission-panel）类型零破坏。
- `listWorkspaceDialogs(workspaceId)` 调 `GET /api/workspaces/{id}/dialogs`，返回项含来源字段（查询路齐全）。
- SSE 路经 `parseSessionPermissionEvent` 构造的 request，来源三字段为 `undefined`（前端占位「加载中」，design AC-5）。
- 两路合并键为 `request_id`（与现有 session-permission-panel.tsx:57 去重逻辑一致）。

## 验证
```
cd frontend && pnpm typecheck && pnpm test
```

## 约束
- C4（design §4.4）：SSE 路来源缺省、查询路齐全、两路按 `request_id` 合并。
- 复用 `apiFetch`（与 `fetchPendingDialogs` / `listWorkspaceAgentSessions` 同模式）。
- 纯类型 + 只读查询封装，不触碰 daemon/backend PERMISSION_REQUEST 链路（D-001）。
- 不改 `parseSessionPermissionEvent` 现有 permission_request / permission_resolved 解析逻辑，仅保持来源字段缺省。
- 中文注释，UI 术语除外。
