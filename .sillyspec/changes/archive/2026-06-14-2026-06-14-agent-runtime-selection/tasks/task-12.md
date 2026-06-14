---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-12
title: stage 手动 dispatch + scan 触发 — agent 下拉
priority: P0
estimated_hours: 2
depends_on: [task-06, task-07, task-09]
blocks: [task-14]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/lib/workspaces.ts
  - frontend/src/lib/change.ts
---

# task-12: stage 手动 dispatch + scan 触发 — agent 下拉

## 上下文
两处触发 UI 加 provider 下拉：
1. **stage 手动 dispatch**（`changes/[cid]/page.tsx` 的 `handleDispatch` → `triggerDispatch`）：task-06 后端已支持 `ManualDispatchRequest{provider}`。
2. **scan-generate**（`workspace-scan-dialog.tsx` 的 `handleGenerate` → `scanGenerate`）：task-07 后端已支持 `ScanGenerateRequest{provider}`。
依赖 task-06/07（后端契约）+ task-09（AgentProviderSelect）。

## 修改文件（必填）
- `frontend/src/lib/change.ts` — `triggerDispatch` 增 provider 参数 + Request 类型
- `frontend/src/lib/workspaces.ts` — `ScanGenerateInput` 增 provider
- `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` — handleDispatch 下拉 + 透传
- `frontend/src/components/workspace-scan-dialog.tsx` — handleGenerate 下拉 + 透传

## 实现要求
### A. lib 层
1. **`change.ts`** `triggerDispatch`（POST dispatch）：增可选 `provider`，body 传 `{provider}`（task-06 `ManualDispatchRequest`）；若现状传空 body，改为传 `{provider: provider ?? null}`。
2. **`workspaces.ts`** `ScanGenerateInput`：增 `provider?: string | null`，`scanGenerate` body 带上（task-07 `ScanGenerateRequest`）。

### B. stage dispatch UI（`changes/[cid]/page.tsx`）
1. state `const [provider, setProvider] = useState<string|null>(workspace.default_agent ?? null)`。
2. 在 handleDispatch 触发按钮附近加 `<AgentProviderSelect value={provider} onChange={setProvider} includeDefault />`。
3. `handleDispatch` 调 `triggerDispatch({..., provider})`。

### C. scan UI（`workspace-scan-dialog.tsx`）
1. state `const [provider, setProvider] = useState<string|null>(null)`（scan 通常在新建 workspace 上下文，default_agent 尚未设；用 null 默认）。
2. 对话框内加 `<AgentProviderSelect value={provider} onChange={setProvider} includeDefault />`。
3. `handleGenerate` 调 `scanGenerate({rootPath, provider})`。

## 接口定义（代码类任务必填）
```typescript
// change.ts
export async function triggerDispatch(input: {
  workspaceId: string; changeId: string;
  provider?: string | null;   // 新增
}): Promise<...> {
  return apiFetch(`/api/workspaces/${input.workspaceId}/changes/${input.changeId}/dispatch`, {
    method: "POST", json: { provider: input.provider ?? null },
  });
}

// workspaces.ts
export interface ScanGenerateInput {
  rootPath: string;
  provider?: string | null;   // 新增
}

// changes/[cid]/page.tsx + workspace-scan-dialog.tsx
const [provider, setProvider] = useState<string | null>(workspace.default_agent ?? null);
<AgentProviderSelect value={provider} onChange={setProvider} includeDefault />
```

## 边界处理（必填）
- **stage dispatch 默认联动**：provider 初始 = workspace.default_agent（与 task-11 一致）。
- **scan 默认 null**：scan 对话框通常用于新 workspace，default_agent 未设，初始 null。
- **选"使用默认"**：provider=null → 后端走 default_agent 兜底（stage）或 ORDER BY last_heartbeat（scan 新 workspace）。
- **改下拉**：受控，用户值优先。
- **空 body 兼容**：后端 `Body(default=ManualDispatchRequest)` 保证 provider=null 也接受（task-06 AC-06）。
- **scan 必填 rootPath**：provider 可选，不破坏既有校验。

## 非目标（本任务不做的事）
- 不改后端（task-06/07）。
- 不改 AgentProviderSelect（task-09）。
- 不改自动调度 UI（自动调度用 default_agent，无需前端选）。

## 参考
- `handleDispatch` / `triggerDispatch`（changes/[cid]/page.tsx + change.ts）。
- `handleGenerate` / `scanGenerate`（workspace-scan-dialog.tsx + workspaces.ts）。
- 后端契约 task-06（ManualDispatchRequest）/ task-07（ScanGenerateRequest）。

## TDD 步骤
1. typecheck：`cd frontend && pnpm typecheck`。
2. 手动验收 stage dispatch：选 codex → 重跑 → triggerDispatch body provider=codex；选"使用默认" → null。
3. 手动验收 scan：选 claude → 生成 → scanGenerate body provider=claude。
4. `cd frontend && pnpm build` 通过。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | stage dispatch 选 codex 重跑 | triggerDispatch body provider=codex |
| AC-02 | stage dispatch 默认联动 | 下拉预选 workspace.default_agent |
| AC-03 | stage dispatch 选"使用默认" | provider=null |
| AC-04 | scan 选 claude 生成 | scanGenerate body provider=claude |
| AC-05 | scan 默认 null | 初始"使用默认/未设置" |
| AC-06 | pnpm typecheck + build | 通过 |
