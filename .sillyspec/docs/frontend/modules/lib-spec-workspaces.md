---
schema_version: 1
doc_type: module-card
module_id: lib-spec-workspaces
author: qinyi
created_at: 2026-08-18 01:45:00
---

# spec 工作区客户端（lib-spec-workspaces）

## 定位

spec workspace（工作区的 spec 根/同步策略）API 客户端：查询 spec_ws 状态、
SSE 流式导入、生成项目、init 派发、手动同步与 pending 查询。是「从仓库导入 /
同步到服务器」两条手动链路的前端入口。

## 契约摘要

- `getSpecWorkspace(workspaceId)` — `GET /api/workspaces/{wid}/spec-workspace`，
  返回 `SpecWorkspace { spec_root; strategy; sync_status; ... }`。
- `importSpecWorkspace(workspaceId, { onProgress })` — `POST .../spec-workspace/import`，
  返回 `text/event-stream`；阶段 `packing / packed / applying / reparsing_docs /
  reparsing_changes / done / error`，经 `onProgress(phase, data)` 回调上抛。
- `generateProjects(workspaceId)` — `POST .../generate-projects`，返回生成文件数 +
  reparse 统计 + 子项目列表。
- `initDispatch(workspaceId)` — `POST .../init`，向当前成员 daemon 派发 init 模式
  交互 lease（daemon 写 `.sillyspec-platform.json` 并拉取 spec bundle）。
- `syncManual(workspaceId)` — `POST .../spec-workspace/sync-manual`，建 kind=spec-sync
  的 DaemonChangeWrite outbox 行，返回 `{ status: "pending", task_id }`。
- `listPendingSync(workspaceId)` — `GET .../sync-manual/pending`，按 created_at desc
  返回 `PendingSyncItem[]`（含 error / files_total / files_processed 进度字段）。
- 枚举：`SpecStrategy = platform-managed | repo-mirrored | repo-native`；
  `SyncStatus = pending | clean | dirty | conflicted`。

## 关键逻辑

```
importSpecWorkspace:
  原生 fetch + resp.body.getReader() 手解 SSE（apiFetch 会 JSON.parse，不复用）
  buffer 按 "\n\n" 切事件块；event:/data: 行解析；":" 开头 keepalive 跳过
  非 2xx / error 事件 → throw ApiError；done → resolve
```

## 注意事项

- **符号演进**：早期版本的 `syncSpecWorkspace` / `bootstrapSpecWorkspace` /
  `updateSpecWorkspace` / `listSpecConflicts` / `resolveSpecConflict` 已不存在，
  现行为 `syncManual` / `listPendingSync` / `initDispatch` 等——引用旧名会直接编译错。
- `PendingSyncItem` 字段对齐后端 `sync_manual_get_pending`（旧类型 id/change_key/kind
  曾与后端完全脱节，是修过的 schema 漂移点）；files_total/files_processed 的单一写者
  是 progress 端点（D-004）。
- import 走 SSE 是为了突破同步 POST 的超时（D-001）；调用方 done 后须自行刷新
  spec_ws 状态 + 变更中心列表。
- 消费方：`workspaces/[id]/page.tsx`、`workspaces/[id]/agent/page.tsx`、
  `components/workspace-config-card.tsx`。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
