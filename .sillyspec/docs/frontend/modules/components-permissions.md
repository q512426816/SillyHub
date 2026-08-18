---
schema_version: 1
doc_type: module-card
module_id: components-permissions
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 会话审批询问组件（components-permissions）

## 定位
会话级实时审批/询问聚合组件（`components/permissions/`，2 源文件 + 各自测试）。`SessionPermissionPanel` 订阅多个 daemon 会话的 SSE 流，解析 `permission_request` / `permission_resolved` 事件并结合数据库兜底查询，聚合成统一的"待决策卡片"列表；按 `dialog_kind` 分流渲染 AskUserDialogCard（结构化问答）或 PermissionApprovalCard（allow/deny 审批）。`DialogContextBar` 是卡片的兄弟包裹层，提供来源上下文条（工作区/场景/会话链接/时间/摘要），不侵入卡组件内部。被 `app-layouts`（approvals 区）与 `app-sessions-pages` 使用。

## 契约摘要
- `SessionPermissionPanel`：props `{ sessionIds: string[], pendingFallback?: SessionPermissionRequest[], workspaceName?: string }`。对每个 sessionId 经 `fetchSse`（lib-fetch-sse）订阅 `/api/daemon/sessions/{sid}/stream`，token 走 Authorization Bearer header（不再拼 URL query）。
- `mergeDialogRequests(prev, incoming, fromQuery)`：导出的纯函数，按 `request_id` 幂等合并 SSE 实时增量与查询兜底——查询（fromQuery=true，来源字段齐全）覆盖 SSE 占位的 `workspace_name/session_type/run_summary/created_at/dialog_kind/dialog_payload`，不反向覆盖。
- 渲染分流：`req.dialog_kind` 有值 → `AskUserDialogCard`；无 → `PermissionApprovalCard`。两卡自调审批接口，`onResolved` 后从列表移除。每卡外层包 `DialogContextBar`。
- `DialogContextBar`：props `{ request, children }`；导出 `resolveSessionTypeBadge(session_type)` 纯函数（scan→扫描/chat→对话/stage→阶段，缺省→「加载中」）；会话/运行链接跳 `/runtimes?session=<session_id>`（运行链接带 `#run-<run_id>` hash）。
- 硬上限：`MAX_SESSION_SSE = 50`，超出部分不开 SSE，靠调用方 `GET /workspaces/{id}/dialogs` 轮询兜底。

## 关键逻辑
```
useEffect(() => {                    // sessionIds/token 变化 → 全量重建订阅
  closeAll(); setCards([])
  for (const [i, sid] of sessionIds.entries()) {
    if (i >= MAX_SESSION_SSE) break            // 连接数硬上限 50
    es = fetchSse(url, { token })              // Bearer header 认证
    es.onmessage = (e) => parseSessionPermissionEvent(JSON.parse(e.data))
      → 有 tool_name → mergeDialogRequests(cards, enriched, false)   // 入列
      → 有 decision   → cards.filter(c => c.request_id !== rid)     // 移除
  }
}, [sessionIds, accessToken, workspaceName])
useEffect(() => {                    // pendingFallback 变化 → 查询覆盖 SSE 占位
  pendingFallback?.forEach(req => acc = mergeDialogRequests(acc, enrich(req), true))
}, [pendingFallback, workspaceName])
```

## 注意事项
- `sessionIds` 变化会全量重建订阅并清空卡片，调用方传稳定数组（useMemo）避免反复重连。
- fetchSse 不自动重连（404/401/断网 onerror 静默），容错完全依赖查询兜底轮询；改动兜底轮询前先理解这层取舍。
- 来源字段三条规则：查询覆盖 SSE 占位（C4）、SSE 不反向覆盖已有真实值、`workspaceName` prop 由 page 本地补全 SSE 路缺省。
- token 已从 URL query 移到 Authorization header（防访问日志明文泄漏），勿回退到 query 传参。
- 本组件管的是"会话工具审批/问答"，与 RBAC 菜单权限（lib-permission/lib-menu-permissions）是不同概念，勿混淆。
- `parseSessionPermissionEvent` / `SessionPermissionRequest` 类型定义在 lib-daemon，本模块只消费。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
