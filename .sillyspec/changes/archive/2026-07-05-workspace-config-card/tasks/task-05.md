---
id: task-05
title: 实现未绑定首次引导（WorkspaceAccessGuide 首次模式）+ server-local 字段条件隐藏（daemon/cache_root）+ "服务器本地工作区，无需守护进程"说明文案
change: 2026-07-05-workspace-config-card
author: qinyi
created_at: 2026-07-05T01:18:51
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-006]
decision_ids: []
allowed_paths:
  - frontend/src/components/workspace-config-card.tsx
---

## Goal

在「我的接入」组覆盖两条状态分支：① `myBinding == null` 渲染 `WorkspaceAccessGuide` 首次模式（不传 `initial`）引导用户填 daemon + 本地路径 + 路径来源；② `myBinding.path_source === 'server-local'` 时隐藏「绑定守护进程」「守护进程本地缓存」字段，并在守护进程位显示「服务器本地工作区，无需守护进程」说明。覆盖 FR-006 / design §5.3 状态分支表的"未绑定"与"server-local"两态 / R-02。

## Implementation

1. **未绑定分支**（task-01 骨架已有分支占位，本任务补全渲染）：在「我的接入」组容器内，当 `myBinding == null` 时渲染
   ```tsx
   <WorkspaceAccessGuide
     workspaceId={workspace.id}
     onConfigured={props.onRefresh}
   />
   ```
   - **不传 `initial`** → AccessGuide 内部 `editing = false`，文案为「⚙ 配置你在此工作空间的守护进程和本地路径」（access-guide.tsx:83,134-140）。
   - `onConfigured` 直接绑 `props.onRefresh`：AccessGuide 内部 `handleSave` 完成 `upsertMyBinding` 后回调 → page.tsx `load()` 重拉 `my-binding`，绑定落地后 `myBinding != null`，组件自然切回「已绑定」展示态。
   - **「工作区文档存储」组仍展示**（共享只读，不依赖 binding；specWs 到了就渲染）——不要因未绑定整体隐藏卡片。
2. **server-local 分支**（`myBinding != null && myBinding.path_source === 'server-local'`）：
   - 「我的接入」组「绑定守护进程」字段位：不渲染 daemon-chip，改为静态说明文案 `<span data-testid="server-local-no-daemon">服务器本地工作区，无需守护进程</span>`（access-guide.tsx:161 已支持 daemon_id 可空）。
   - 「工作区文档存储」组：**不渲染**「守护进程本地缓存」字段（cache_root 仅 daemon-client，design §7.4 / D-004@V1）；其余字段（spec_root/runtime_root/spec_version/sync_status/last_synced_at/strategy）正常展示。
3. **daemon-client 分支**（`myBinding.path_source === 'daemon-client'`）：保持 task-02 默认渲染（daemon-chip + cache_root 字段均展示），本任务不动。
4. **路径来源 badge** 复用 `workspacePathSourceLabel`（workspace-path.ts:10-12）：`daemon-client` → "本机守护进程路径" / `server-local` → "服务器本地路径"。
5. 文案统一中文（CLAUDE.md 规则 11/15），不出现「守护进程」「daemon」之外的英文术语。

## Acceptance

- AC-1: `myBinding == null` 时「我的接入」组渲染 `<WorkspaceAccessGuide>` 首次模式（无 `initial`），「工作区文档存储」组在 `specWs != null` 时正常展示（不被未绑定整体抑制）。
- AC-2: 首次模式保存成功（AccessGuide 内 `upsertMyBinding`）后触发 `props.onRefresh`，page.tsx reload 使 `myBinding` 落地，组件自动切回已绑定展示态。
- AC-3: `path_source === 'server-local'` 时不渲染 daemon-chip 与「守护进程本地缓存」字段；「绑定守护进程」位展示 `data-testid="server-local-no-daemon"` 文案"服务器本地工作区，无需守护进程"。
- AC-4: `path_source === 'daemon-client'` 时 task-02 默认渲染不受影响（daemon-chip + cache_root 均在）。

## Verify

```bash
cd frontend && pnpm exec tsc --noEmit
cd frontend && pnpm exec vitest run src/components/workspace-config-card.test.tsx
```

补充：task-08 会补「未绑定首次引导」+「server-local 隐藏」测试用例（design §6 测试覆盖 §5.3 全六态）；本任务交付时可先手写最小冒烟占位（断言 AccessGuide 在 myBinding==null 时渲染、server-local 时 cache_root 字段 absent），由 task-08 完善。

## Constraints

- **复用 `WorkspaceAccessGuide` 首次模式**（不传 `initial` 即触发），**不重写**首次表单（D-005@V1 / access-guide.tsx:73-83）。
- **server-local 隐藏规则**：仅 `path_source === 'server-local'` 触发；隐藏字段限定「绑定守护进程」(daemon-chip) + 「守护进程本地缓存」(cache_root) 两项，**不得**误伤 spec_root/runtime_root/spec_version/sync_status 等共享字段（design §5.3 / R-02）。
- 「工作区文档存储」组对未绑定与 server-local 两态均保持可见（共享只读组不依赖 binding）。
- daemon-client 分支渲染完全沿用 task-02，本任务不重复实现。
- 仅修改 `frontend/src/components/workspace-config-card.tsx`（allowed_paths）；不碰 access-guide.tsx / workspace-path.ts / workspace-binding.ts / page.tsx。
- `path_source` 取值仅 `'server-local' | 'daemon-client'`（OpenAPI 类型 `WorkspacePathSource`），用全等比较，不写 `!== 'daemon-client'` 的反向判断以防枚举扩展时漏改。
