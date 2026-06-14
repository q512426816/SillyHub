---
author: qinyi
created_at: 2026-06-14T22:04:34
id: task-08
title: workspaces.ts — Workspace 接口增 default_agent + 新增 updateWorkspace（PATCH）
priority: P0
estimated_hours: 1
depends_on: [task-04]
blocks: [task-10]
allowed_paths:
  - frontend/src/lib/workspaces.ts
---

# task-08: workspaces.ts — Workspace 接口增 default_agent + 新增 updateWorkspace（PATCH）

## 上下文
前端 Workspace 类型需要 `default_agent` 字段，并新增 `updateWorkspace` 函数调 PATCH（task-04 后端契约）。workspace 设置页（task-10）依赖本任务。后端契约由 task-04 保证（PATCH `/api/workspaces/{id}` 支持 default_agent）。

## 修改文件（必填）
- `frontend/src/lib/workspaces.ts` — `Workspace` 接口 + 新增 `updateWorkspace`

## 实现要求
1. **`Workspace` 接口**增 `default_agent: string | null;`（放在 `default_branch` 之后）。
2. **新增 `updateWorkspace`**：
   ```typescript
   export interface UpdateWorkspaceInput {
     name?: string;
     slug?: string;
     description?: string;
     default_agent?: string | null;
   }

   export async function updateWorkspace(
     id: string,
     patch: UpdateWorkspaceInput,
   ): Promise<Workspace> {
     return apiFetch<Workspace>(`/api/workspaces/${id}`, {
       method: "PATCH",
       json: patch,
     });
   }
   ```
   风格对齐既有 `createWorkspace` / `getWorkspace`（都用 apiFetch）。
3. 类型保持与后端 `WorkspaceRead`（task-04）字段一致。

## 接口定义（代码类任务必填）
```typescript
export interface Workspace {
  // ... 既有字段 ...
  default_branch: string | null;
  default_agent: string | null;   // 新增
  // ...
}

export async function updateWorkspace(id: string, patch: UpdateWorkspaceInput): Promise<Workspace>
```

## 边界处理（必填）
- **default_agent null**：类型 `string | null`，对应后端未设置（FR-01 第二块清空）。
- **PATCH 清空**：`updateWorkspace(id, {default_agent: null})` → 后端 exclude_unset 下显式 null → 置 NULL。
- **PATCH 部分字段**：UpdateWorkspaceInput 全 optional，只传 default_agent 时后端 exclude_unset 不动其他字段。
- **apiFetch 错误**：复用既有 ApiError 处理（4xx/5xx 抛 ApiError）。
- **返回值**：返回完整 WorkspaceRead（含更新后的 default_agent）。
- **不破坏既有调用**：新增函数 + 新增可选字段，既有代码不受影响。

## 非目标（本任务不做的事）
- 不改其他 lib 文件（daemon.ts / agent.ts）。
- 不写 UI（task-10）。
- 不改后端（task-04）。

## 参考
- 既有 `createWorkspace` / `getWorkspace`（workspaces.ts）的 apiFetch 用法。
- daemon.ts 的 `DaemonRuntimeRead` / `PROVIDER_META`（task-09 复用）。

## TDD 步骤
1. typecheck 先行：`cd frontend && pnpm typecheck` —— 新增字段/函数无类型错误。
2. （前端无单测框架时）手动验证：在 task-10 设置页调用 updateWorkspace PATCH default_agent。
3. `cd frontend && pnpm build` 通过。

## 验收标准
| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | pnpm typecheck | 无错误 |
| AC-02 | Workspace 接口含 default_agent: string \| null | 类型完整 |
| AC-03 | updateWorkspace 调 PATCH /api/workspaces/{id} | 请求方法+body 正确 |
| AC-04 | updateWorkspace(id,{default_agent:null}) | 发送显式 null（清空） |
| AC-05 | pnpm build | 通过 |
