---
author: qinyi
created_at: 2026-07-05T01:18:51
change: 2026-07-05-workspace-config-card
stage: execute
task_id: task-07
name: page.tsx 改造——删除规范管理区替换为 WorkspaceConfigCard
priority: P0
depends_on: [task-01]
blocks: [task-09]
requirement_ids: [FR-003]
decision_ids: [D-003@V1]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
---

# Task-07 · page.tsx 改造

## Goal

把 `workspaces/[id]/page.tsx` 第 598-825 行「规范管理（Spec Workspace）」SectionCard 整段 JSX 删除，连同配置相关 state / handlers / 轮询 ref 一并迁出，原位替换为 `<WorkspaceConfigCard workspace={workspace} specWs={specWs} myBinding={myBinding} boundDaemon={boundDaemon} isOwner={isOwner} onRefresh={load} />`。详情页其他区块（基本信息 / 默认智能体 / Overview / Quick nav）行为不变。对应 design §5.2 + §6 第 3 行 + D-003@V1。

## Implementation

1. **删除 JSX**（第 598-825 行）：整段 `<SectionCard title="规范管理（Spec Workspace）">…</SectionCard>`，含 head-actions 操作按钮（初始化/扫描/同步/导入/生成项目）、三态引导逻辑、spec_root/sync_status/profile_version/last_synced_at 只读字段。
2. **原位插入**：
   ```tsx
   <WorkspaceConfigCard
     workspace={workspace}
     specWs={specWs}
     myBinding={myBinding}
     boundDaemon={boundDaemon}
     isOwner={isOwner}
     onRefresh={load}
   />
   ```
3. **删除配置 state**（第 106-123 行附近）：`importing` / `importPhase` / `activeScanRunId` / `scanStatus` / `scanError` / `scanning` / `generatingProjects` / `initSyncedAt` / `initing` / `initPollRef` / `syncStatus` / `syncError` / `syncPollRef`，以及派生 `scanInterrupted`。
4. **删除 handlers**（第 262-441 行）：`handleInit` / `handleSyncManual` / `handleScan` / `handleGenerateProjects` / `handleImport` / `closeScanPanel`（若仅被规范管理区引用）。
5. **保留共享 state**：`workspace` / `specWs` / `myBinding` / `boundDaemon` / `boundDaemonProviders` / `boundRuntime` / `componentCount` / `activeChanges` / `archivedChanges` / `currentStage` / `defaultAgent` / `defaultModel` / `loading` / `pageError` / `isOwner`（基本信息、默认智能体、Overview 等区块共用，作为 props 喂给卡片）。
6. **卸载清理**：原本规范管理区相关的 `initPollRef` / `syncPollRef` clearInterval 逻辑（及 visibilitychange / 5min 上限 setTimeout 清理）随 handlers 迁入卡片（task-06 负责），page.tsx 顶层不再保留这些 ref 的清理。
7. **清理 import**：删除仅被删除的 handlers/state 使用的符号（如 `initDispatch` / `syncManual` / `scanGenerate` / `generateProjects` / `importSpecWorkspace` / `listPendingSync` / `ImportPhase` / `AgentRunStatus` 等）——逐个 grep 确认 page.tsx 内无其他引用再删，避免误删仍被其他区块使用的符号。
8. **新增 import**：`import { WorkspaceConfigCard } from "@/components/workspace-config-card";`。
9. `load()` 函数保持不变（仍刷新共享数据），作为 `onRefresh` 传给卡片。

## Acceptance

- AC-1 第 598-825 行原 SectionCard 已删除，原位渲染 `<WorkspaceConfigCard>`（D-003@V1 / FR-003）。
- AC-2 配置相关 state（initing/initSyncedAt/syncStatus/syncError/scanning/activeScanRunId/scanStatus/scanError/importing/importPhase/generatingProjects）+ initPollRef/syncPollRef + 5 个 handlers 全部从 page.tsx 移除。
- AC-3 共享 state（workspace/specWs/myBinding/boundDaemon/boundDaemonProviders/boundRuntime/componentCount/activeChanges/archivedChanges/currentStage/defaultAgent/defaultModel）保留，基本信息/默认智能体/Overview/Quick nav 区块引用无回归。
- AC-4 卸载/轮询清理逻辑随 handlers 迁入卡片，page.tsx 不再持有定时器 ref。
- AC-5 详情页其他区块（基本信息、默认智能体、Overview 四宫格、Quick nav）渲染与交互行为零变化。

## Verify

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm exec vitest run src/app/\(dashboard\)/workspaces/\[id\]/page.test.tsx
```

通过门槛：tsc 零报错；page.test.tsx 全绿（task-09 之前允许现有用例对新卡片结构暂以渲染存在性断言宽松通过，结构断言由 task-09 收紧）。

## Constraints

- 仅改 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`（allowed_paths 锁定）。
- 不动基本信息区的 `WorkspaceDaemonSwitcher`（轻量改 daemon 入口，与卡片"编辑我的接入"职责不同，共存不冲突，design §5.4）。
- 不改 `load()` 函数签名与请求集合（共享数据来源稳定）；卡片内部如需额外刷新由 task-06 自行处理。
- 删除 import 时必须 grep 验证 page.tsx 内无残留引用，禁止误删仍被其他区块使用的类型/函数（如 `ApiError` / `formatTs` / `useSession` 等保留）。
- 操作按钮 handlers 等价搬迁由 task-06 在卡片内完成；本任务只做 page.tsx 侧"断链 + 替换 + 清理"。
- 不引入 backend / daemon / migration 改动。
