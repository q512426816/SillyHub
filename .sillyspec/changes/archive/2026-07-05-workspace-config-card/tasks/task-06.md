---
task_id: task-06
title: 操作按钮 handlers 等价迁入（init/scan/sync/import/generate + 轮询 + 409 重扫 + SSE + 卸载清理）
change: 2026-07-05-workspace-config-card
author: qinyi
created_at: 2026-07-05T01:18:51
priority: P0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-007]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
---

# Task-06 操作按钮 handlers 等价迁入

## Goal

把 `page.tsx` 第 264-441 行五个操作按钮 handler（handleInit / handleScan / handleSyncManual / handleImport / handleGenerateProjects）及其依赖的状态机（initPollRef / syncPollRef 轮询、visibilitychange 暂停、5min 上限、409 重扫确认、SSE onProgress、卸载清理、owner 门禁）等价迁入 `WorkspaceConfigCard`，行为与原 page.tsx 逐字节对等，FR-007 / SC-6 / AC-07 的承载任务。

## Implementation

1. 在 `workspace-config-card.tsx`（task-01 骨架已建）内补齐操作按钮相关 state：
   - `initing` / `initSyncedAt` / `syncStatus: 'idle'|'syncing'|'done'|'failed'` / `syncError`
   - `scanning` / `activeScanRunId` / `scanStatus` / `scanError`
   - `importing` / `importPhase: string | null`
   - `generatingProjects`
   - `initPollRef = useRef<ReturnType<typeof setInterval> | null>(null)` / `syncPollRef` 同
2. 五个 handler 等价搬迁（来源 page.tsx 264-441 行），改写规则：
   - `workspaceId` → 来自 props（或 `workspace.id`）
   - `specWs` → 读 `props.specWs`（门禁/参数，对应 R-06）
   - `componentCount` → 由 props 注入或从 `props.workspace`/`onRefresh` 后回调读（保留 409+componentCount 双门禁）
   - `workspace.daemon_runtime_id` / `workspace.root_path` / `workspace.default_agent` / `workspace.default_model` → 读 `props.workspace.*`
   - `setPageError` → 内部 `setLocalError`，与卡片 error 分支联动
   - `setSpecWs(await getSpecWorkspace(...))`（handleImport 末尾）→ 改为 `await onRefresh()`（props 回调让 page.tsx 重新 load 共享 specWs，避免双源真相）
   - `void load()` → `void onRefresh()`
3. handleInit：`initDispatch(workspaceId)` → 2s `setInterval` 轮询 `fetchMyBinding` → `init_synced_at` 非空则 clearInterval + `setInitSyncedAt` + onRefresh；轮询体内 `if (document.hidden) return`（visibilitychange 暂停）。
4. handleSyncManual：`syncManual(workspaceId)` → `result.status==='done'` 即止；否则 2s `setInterval` 轮询 `listPendingSync`，`done`/`failed`/空 latest 收尾；`setTimeout(5*60*1000)` 上限：仍在 syncing 则 setSyncError+setSyncStatus('failed')+clearInterval。
5. handleScan：componentCount>0 先 `window.confirm`；调 `scanGenerate(root_path, default_agent, default_model, 'daemon-client', daemon_runtime_id, strategy)`；catch 内 409 → `window.confirm` → 确认则递归 re-invoke（保留 `setScanning(false)` 释放锁后再调）。
6. handleImport：`importSpecWorkspace(workspaceId, { onProgress: phase => setImportPhase(phase) })`（SSE onProgress）；成功 → `onRefresh`；finally `setImporting(false)`+`setImportPhase(null)`。
7. handleGenerateProjects：`generateProjects(workspaceId)` → `result.reparse.created>0` 则 onRefresh，否则 setLocalError("未生成新的项目组件…")。
8. owner 门禁：扫描/生成项目按钮 `disabled={!isOwner}`（与 page.tsx 原一致）；其余按钮按数据状态条件渲染。
9. 卸载清理：`useEffect(() => () => { if (initPollRef.current) clearInterval(...); if (syncPollRef.current) clearInterval(...); }, [])`。

## Acceptance

- AC-07：五个按钮在新卡片内行为与改造前等价（initPollRef 2s 轮询+visibilitychange 暂停 / syncPollRef 2s 轮询+5min 上限 / 409 重扫 window.confirm+componentCount 门禁+owner disabled / handleImport SSE onProgress / 卸载 clearInterval）。
- 不引入 backend API 改动；不改 daemon 端。

## Verify

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm exec vitest run src/components/workspace-config-card.test.tsx
```

## Constraints

- **R-01 P0**：handlers 行为与 page.tsx 第 264-441 行原逻辑逐字节等价；轮询间隔/上限/visibilitychange 分支/window.confirm 文案/SSE onProgress 回调签名零偏移。
- 共享数据走 props（`workspace` / `specWs` / `myBinding`），操作完成后调 `props.onRefresh` 让 page.tsx reload；卡片内不再独立请求 specWs。
- handleImport 末尾原 `setSpecWs(await getSpecWorkspace(...))` 改为 `await onRefresh()`，避免与 page.tsx 顶层 specWs state 双源。
- 卸载时 `clearInterval(initPollRef.current)` + `clearInterval(syncPollRef.current)` 必做。
- 不改 backend API 调用签名（initDispatch/syncManual/scanWorkspace/importSpecWorkspace/generateProjects/listPendingSync/fetchMyBinding/getSpecWorkspace 均原样调用）。
