---
schema_version: 1
doc_type: module-card
module_id: components-permissions
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:00
---
# components-permissions

## 定位
会话级权限请求聚合组件（`components/permissions/session-permission-panel.tsx`）。订阅一个或多个 daemon 运行时会话的 SSE 流，从中解析 `permission_request` / `permission_resolved` 事件，聚合成统一的"待决策权限卡片"列表，单卡交互复用 `PermissionApprovalCard`（自调 `respondSessionPermission`，resolved 后从列表移除）。用于 AgentPage 等需要响应 agent 工具调用授权请求的场景。

## 契约摘要
- `SessionPermissionPanel`：props `{ sessionIds: string[] }`；对每个 sessionId 建 `EventSource` 订阅 `/api/daemon/sessions/{sid}/stream`（token 走 query）；解析事件 → 命中 `permission_request` 且含 `tool_name` 则作为 `SessionPermissionRequest` 去重入列 → 命中 `permission_resolved` 按 `request_id` 移除。
- 渲染：列表内每项用 `<PermissionApprovalCard key={request_id} ... onResolved={() => 移除}>`，单卡自行调用审批接口。

## 关键逻辑
- 订阅生命周期（伪代码）：
  ```
  useEffect(() => {
    sourcesRef.current.forEach(es => es.close()); sourcesRef.current.clear(); setCards([])
    for (const sid of sessionIds) {
      const es = new EventSource(`${base}/api/daemon/sessions/${sid}/stream?token=...`)
      es.onmessage = (e) => {
        const parsed = parseSessionPermissionEvent(JSON.parse(e.data))
        if (parsed?.tool_name) setCards(prev => dedupeAdd(prev, parsed))   // request_request
        else if (parsed?.request_id) setCards(prev => prev.filter(c => c.request_id !== parsed.request_id))  // resolved
      }
      sourcesRef.current.set(sid, es)
    }
    return () => sourcesRef.current.forEach(es => es.close())
  }, [sessionIds, accessToken])
  ```
- 非 JSON / 非 permission 事件直接忽略（其它 SSE 事件类型由其它订阅方处理）。

## 注意事项
- sessionIds 变化会全量重建订阅并清空卡片，调用方传稳定数组（useMemo）避免反复重连。
- token 经 query 传递是 EventSource 限制（见 app-api-routes），SSE 端点必须同源代理。
- 去重以 `request_id` 为 key，重复 request 不重复入列。
- 组件只管"待决策"权限卡片，与 RBAC 菜单权限（lib-permission/lib-menu-permissions）是不同概念，勿混淆。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
