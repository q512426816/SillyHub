---
schema_version: 1
doc_type: module-card
module_id: lib-daemon-audit
author: qinyi
created_at: 2026-08-18 01:45:00
---

# daemon 写策略审计客户端（lib-daemon-audit）

## 定位
daemon filesystem-policy（写策略拦截）审计日志的查询客户端 + TanStack Query hooks（变更 2026-07-02-daemon-filesystem-policy task-19，D-006@v1）。daemon 按 allowed_paths 策略拦截文件写操作时落审计事件，本模块把后端两个 GET 查询端点封装成函数与 hook，供 `/runtimes/[id]/audit` 审计页消费。查询需 RUNTIME_ADMIN 权限（backend 网关），越权抛 403 ApiError；本模块只有读能力，无写入/确认操作。

## 契约摘要
- `fetchPolicyAudit(workspaceId, runtimeId, params)` → `AuditPageResponse`
  - GET `/api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit`（workspace + runtime 双维度，分页 + 筛选，结果 created_at DESC）。
- `fetchPolicyAuditByRuntime(runtimeId, params)` → `AuditPageResponse`
  - GET `/api/daemon/runtimes/{rid}/policy-audit`（免 workspace 维度，ql-20260703-003 新增；审计页无 workspace 上下文时用，返回该 runtime 全部记录）。
- `usePolicyAudit(workspaceId?, runtimeId?, params?, options?)` / `usePolicyAuditByRuntime(runtimeId?, params?, options?)`
  - useQuery 封装，扁平返回 items / total / isLoading / isError / error / refetch（usePolicyAudit 另含 limit/offset/isFetching）。
  - `enabled` 默认随 id 是否存在；`options.refetchInterval` 可选轮询——默认不轮询（审计是回看场景非实时）。
- `FetchPolicyAuditParams`：`decision`（"ALLOW" | "DENY"）/ `provider` / `tool` / `path`（子串匹配）/ `since` / `until`（ISO 8601）/ `limit`（后端默认 50，范围 [1,200]）/ `offset`。
- `AuditLogRead`：id / runtime_id / workspace_id（可空，daemon 上报 best-effort 解析）/ decision / provider / tool / path / reason（ALLOW 时常为空串）/ created_at（入库时间）。

## 关键逻辑
```
queryKey = ["daemonAudit", "page", String(wid), rid, params]   // params 整体进 key：
        // 筛选/翻页变化即新查询（react-query 自动停旧启新）
usePolicyAudit = useQuery({ queryKey, queryFn: fetchPolicyAudit, enabled, refetchInterval })
返回 { items: data?.items ?? [], total: data?.total ?? 0, ... }   // 空态兜底
```

## 注意事项
- **实际路径含 `/daemon` 段**：design §7.3 原写 `/api/workspaces/...`，但 audit router 挂在 daemon router 下继承 `/daemon` prefix（allowed_paths 禁止改 main.py），前端必须用 `/api/daemon/workspaces/...` 否则 404（task-10 已记录该偏差）。
- 参数名是 `since/until/limit/offset`（对齐后端 Query 实现），非 design 文案的 startTime/endTime/page/pageSize；响应分页字段为 total/limit/offset（无 page/pageSize）。
- queryKey 内联在本模块而非 `lib/query-keys.ts`——当时该文件不在任务 allowed_paths 内；若统一收敛 queryKey 需同步迁移两处 key 定义。
- `AuditDecision` 收敛为字面量联合，但 `AuditLogRead.decision` 放宽为 string——后端按 str 存储，兼容未来扩展。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
