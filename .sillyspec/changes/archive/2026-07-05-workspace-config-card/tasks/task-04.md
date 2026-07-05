---
id: task-04
title: 实现编辑入口就地展开（复用 WorkspaceAccessGuide 编辑模式 + 回填当前 binding + 保存调 upsertMyBinding + onRefresh + 收起）
change: 2026-07-05-workspace-config-card
author: qinyi
created_at: 2026-07-05T01:18:51
priority: P0
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-008]
decision_ids: [D-002@V1]
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
---

## Goal

在「我的接入」组实现「编辑我的接入」按钮：点击就地展开 `WorkspaceAccessGuide` 编辑模式（回填当前 binding 三字段），保存调 `upsertMyBinding` 后通知 `props.onRefresh` 刷新共享数据并收起表单。覆盖 FR-008 / D-002@V1（编辑限定 daemon_id + root_path + path_source 三字段，spec_root 不改）。

## Implementation

1. 卡片内部新增 state：`const [editing, setEditing] = useState(false)`（task-01 骨架已具备组件壳与 props）。
2. 「我的接入」组右上角渲染按钮：
   - `<Button size="sm" variant="outline" data-testid="config-edit-entry" onClick={() => setEditing(v => !v)}>{editing ? "收起" : "编辑我的接入"}</Button>`
   - 仅 `myBinding != null` 时渲染（首次未绑定引导由 task-05 处理，不在本任务范围）。
3. 就地展开（非 Modal）：当 `editing === true` 时，在该组内（字段网格下方）渲染：
   ```tsx
   <WorkspaceAccessGuide
     workspaceId={workspace.id}
     onConfigured={() => { setEditing(false); props.onRefresh(); }}
     initial={{
       daemon_id: myBinding.daemon_id,
       root_path: myBinding.root_path,
       path_source: myBinding.path_source,
     }}
   />
   ```
   - `initial` 非空 → AccessGuide 内部 `editing = true`，文案切到「编辑我的接入配置 / 保存修改」（见 access-guide.tsx:83,133-140,221）。
   - 保存逻辑由 AccessGuide 内部 `handleSave` 完成（access-guide.tsx:108-125）：构造 `MemberBindingUpsertRequest { daemon_id, root_path, path_source }` → `upsertMyBinding(workspaceId, req)`（workspace-binding.ts:51-59，PUT `/api/workspaces/{id}/my-binding`）→ 调 `onConfigured`。
   - 本组件不在卡片层重新调用 `upsertMyBinding`，复用 AccessGuide 既有保存链路（D-005@V1 复用不重写）。
4. `onConfigured` 回调：① `setEditing(false)` 收起表单；② 调 `props.onRefresh()` 触发 page.tsx `load()` 重拉 `my-binding` + `spec-workspace` 等共享数据，使「我的接入」组字段（含 init_synced_at 徽标）刷新到新值。

## Acceptance

- AC-1: `myBinding != null` 时「我的接入」组右上角展示 `data-testid="config-edit-entry"` 按钮；`myBinding == null` 不渲染（task-05 边界）。
- AC-2: 点击按钮 → `editing=true` → AccessGuide 编辑模式就地展开（非 Modal/弹层），表单回填 `daemon_id / root_path / path_source` 当前值。
- AC-3: 再次点击按钮 → `editing=false` → 表单收起。
- AC-4: 在展开表单修改三字段任一并点「保存修改」→ AccessGuide 调 `upsertMyBinding` 成功 → 触发 `onConfigured` → 卡片收起表单 + 调 `props.onRefresh()` → page.tsx reload 后字段显示新值。
- AC-5: 保存失败（upsertMyBinding 抛错）→ AccessGuide 内部展示错误条且不收起（access-guide.tsx:120-121），卡片层 `editing` 不变。

## Verify

```
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm exec vitest run src/components/__tests__/workspace-config-card.test.tsx
```

补充：task-08 会写编辑流程的测试用例（保存成功收起 + onRefresh 调用 + 失败不收起）；本任务交付时可先手写最小冒烟断言占位，由 task-08 完善。

## Constraints

- 复用 `WorkspaceAccessGuide` 编辑模式（传 `initial` 触发），**不重写**编辑表单逻辑（D-005@V1）。
- **就地展开**（条件渲染在「我的接入」组内），不弹 Modal/Drawer/Dialog（FR-008 / design §5.4）。
- 保存后必须 `setEditing(false)` + `props.onRefresh()` 双触发；漏任一即视为未完成。
- 编辑字段限定 **daemon_id + root_path + path_source** 三字段（D-002@V1）；**不改 spec_root / runtime_root / strategy** 等工作区共享字段（design §3 N1）。
- 仅修改 `frontend/src/components/workspace-config-card.tsx`（allowed_paths）；不碰 access-guide.tsx / workspace-binding.ts / page.tsx。
- `MemberBindingUpsertRequest` 类型来自 `@/lib/workspace-binding`（OpenAPI 生成），`daemon_id` 可为 `null`（不绑定守护进程），`root_path` 必填。
