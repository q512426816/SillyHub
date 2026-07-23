---
id: task-06
title: 新建 frontend/src/components/workspace-binding-dialog.tsx — 容器化包裹现有 WorkspaceAccessGuide（不重写表单），props {workspaceId, open, onBound, onClose}
title_zh: daemon 绑定弹窗（容器化 AccessGuide）
author: qinyi
created_at: 2026-07-09 23:08:00
priority: P0
depends_on: []
blocks: [task-07, task-08]
allowed_paths:
  - frontend/src/components/workspace-binding-dialog.tsx
---

## 目标(goal)

为「未绑定工作区被点击」场景提供 daemon 绑定弹窗容器。新建 `frontend/src/components/workspace-binding-dialog.tsx`，**只做弹窗容器**（shadcn `Dialog`），内部渲染现有 `WorkspaceAccessGuide`（首次绑定模式），由 task-07（列表选择器）/ task-08（顶栏切换器）在用户点击未绑定工作区时弹出。绑好才进入工作区，避免落到详情页才发现没 daemon。

覆盖：FR-05（daemon 绑定前置完成）、D-003（未绑定弹绑定弹窗，非内嵌下拉）、CB-2（Dialog 容器化复用 AccessGuide，不重写表单）、CB-1（与详情页 WorkspaceBindingGuard 分工：弹窗管首次绑定，Guard 保留为编辑入口）。

## 实现(implementation)

新建 `frontend/src/components/workspace-binding-dialog.tsx`，参照现有受控弹窗 `components/daemon/runtime-session-dialog.tsx` 的 `open`/`onClose` 受控模式（`Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}`）。

**核心契约（CB-2 强制）**：弹窗**只做容器**，内部 `<WorkspaceAccessGuide workspaceId={workspaceId} onConfigured={handleConfigured} />`（**不传 `initial`** = 首次绑定模式，AccessGuide 走 unbound 分支）。**禁止**在本文件重新实现 daemon 下拉 / root_path 输入 / path_source 选择 / `upsertMyBinding` 调用——这些都已封装在 AccessGuide，重写会造成双份维护。

弹窗骨架（用项目 `ui/dialog.tsx`：Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription）：
- 标题：「配置此工作空间的守护进程」
- 副标题（DialogDescription）：「绑定你的守护进程和本地路径后才能进入工作区。」
- 主体：`<WorkspaceAccessGuide workspaceId={...} onConfigured={handleConfigured} />`（AccessGuide 自带黄底卡片样式，置于 DialogContent 内即可）
- 关闭：`DialogContent` 自带右上角 X（`onOpenChange` → `onClose`）；ESC/点遮罩同理由 Radix 处理

回调桥接：
- `WorkspaceAccessGuide.onConfigured` 触发时，本组件先 `await fetchMyBinding(workspaceId)` 取回最新绑定对象，再调 `onBound(binding)` 上抛给父级（task-07 列表页刷新+进入 / task-08 切换器刷新）。取回失败时退化为 `onBound(null)`（父级可按 null 重新拉列表兜底），但仍 `onClose()` 关窗——绑定的写入已在 AccessGuide 内确认成功，不因回读失败卡住用户。
- `onClose` 透传给 Radix `onOpenChange` 关闭态，**不在本组件持有 open state**（open 由父级控制）。

## provides

- `frontend/src/components/workspace-binding-dialog.tsx`：`WorkspaceBindingDialog` 组件
- Props（以 `design.md` §7 `WorkspaceBindingDialogProps` 为准）：
  - `workspaceId: string`
  - `open: boolean`（外层受控）
  - `onBound: (binding: MemberBindingView | null) => void`（AccessGuide 保存成功后上抛最新绑定；null = 回读失败兜底）
  - `onClose: () => void`

## expects_from

- `WorkspaceAccessGuide`（现有 `components/workspace-access-guide.tsx`）：首次绑定模式（不传 `initial`），props `workspaceId` + `onConfigured`
- `fetchMyBinding`（现有 `lib/workspace-binding.ts`）：保存成功后回读最新绑定对象上抛父级
- `ui/dialog.tsx`（现有）：Dialog/DialogContent/DialogHeader/DialogTitle/DialogDescription
- `MemberBindingView` 类型（现有 `lib/workspace-binding.ts`，OpenAPI 生成）

## 验收标准

- [ ] 文件 `frontend/src/components/workspace-binding-dialog.tsx` 存在
- [ ] 导出 `WorkspaceBindingDialog` 组件，props 四字段齐备（workspaceId/open/onBound/onClose）
- [ ] **CB-2**：组件内**未**重复实现 daemon 下拉/root_path/path_source 表单字段，也未直接调 `upsertMyBinding`（统一委托 AccessGuide）
- [ ] `open=false` 时不渲染内容（Radix `Dialog` 受控），`open=true` 时展示 AccessGuide
- [ ] AccessGuide `onConfigured` 触发后：先 `fetchMyBinding` 回读 → 调 `onBound(binding|null)` → 调 `onClose()`
- [ ] **CB-1**：本 task **不修改/不删除** `components/workspace-binding-guard.tsx`（Guard 保留为详情页编辑入口，与弹窗互补）
- [ ] 弹窗用 `ui/dialog.tsx`（Radix），可访问性：`DialogTitle`/`DialogDescription` 齐备（Radix 要求 Title，否则警告）
- [ ] 新增组件单测：open=false 渲染空 / open=true 渲染 AccessGuide（mock fetchMyBinding） / onConfigured 后 onBound+onClose 被调用

## 验证(verify)

```bash
cd frontend
pnpm test -- components/workspace-binding-dialog   # 新增组件单测
pnpm typecheck
pnpm lint
```

## 约束(constraints)

- **CB-2 容器化**：只做壳，表单逻辑全在 AccessGuide。重写表单=双份维护，明确禁止。
- **CB-1 分工**：弹窗管首次绑定（task-07/08 调用），详情页 `WorkspaceBindingGuard` 保留为编辑入口（bound 分支渲染「编辑我的接入配置」按钮）。本 task 不动 Guard。
- **不持 open state**：open 由父级控制，本组件纯受控（与 `runtime-session-dialog.tsx` 一致）。
- 仅改 `frontend/src/components/workspace-binding-dialog.tsx` 一个文件（allowed_paths）。
- AccessGuide 首次绑定模式 = 不传 `initial`（传 `initial` 会切编辑文案+回填，属 Guard 的编辑场景，本弹窗不用）。
