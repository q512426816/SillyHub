---
id: task-04
title: 前端 API 函数 — changes.ts 新增 createChange()
priority: P0
estimated_hours: 0.5
depends_on:
  - task-01
blocks:
  - task-05
allowed_paths:
  - frontend/src/lib/changes.ts
---

# task-04: 前端 API 函数

## 目标

在 `frontend/src/lib/changes.ts` 中新增 `createChange()` 函数，支持传入 `description` 和 `scope` 参数，调用后端 `POST /workspaces/{id}/changes/create` 端点，供新建变更页面使用。

## 操作步骤

### Step 1 — 新增类型定义

文件：`frontend/src/lib/changes.ts`

在文件类型定义区域（约第 72 行 `ChangeReparseResponse` 之后）增加：

```typescript
/** 创建变更的请求参数 */
export type CreateChangeInput = {
  title: string;
  description?: string;
  scope?: "full" | "quick";
  change_type?: string;
  affected_components?: string[];
  lease_id?: string;
};

/** 创建变更的响应 */
export type CreateChangeResponse = {
  id: string;
  workspace_id: string;
  change_key: string;
  title: string | null;
  status: string;
  path: string;
  current_stage: string | null;
  created_at: string;
};
```

### Step 2 — 新增 createChange 函数

在文件末尾（`updateChangeProgress` 之后）添加：

```typescript
/**
 * 创建变更 — POST /workspaces/{id}/changes/create
 *
 * 支持传入 description 和 scope，两者均有后端默认值。
 */
export function createChange(
  workspaceId: string,
  input: CreateChangeInput,
) {
  return apiFetch<CreateChangeResponse>(
    `/api/workspaces/${workspaceId}/changes/create`,
    {
      method: "POST",
      json: input,
    },
  );
}
```

### Step 3 — 增加执行变更的 API 函数（预置）

为 task-06/08 前端调用预留，提前添加 execute 端点：

```typescript
/**
 * 启动变更执行 — POST /workspaces/{id}/changes/{changeKey}/execute
 *
 * 后端会创建 AgentRun 并后台执行 SillySpec 流程。
 */
export function executeChange(
  workspaceId: string,
  changeKey: string,
) {
  return apiFetch<{ ok: boolean; run_id: string }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/execute`,
    { method: "POST" },
  );
}
```

### Step 4 — 验证构建

```bash
cd /Users/qinyi/SillyHub/frontend
npm run build 2>&1 | tail -20
```

确认无类型错误。`createChange` 和 `executeChange` 暂未被引用不会有问题（纯导出函数）。

## 完成标准

- [ ] `CreateChangeInput` 类型包含 `title`, `description?`, `scope?`, `change_type?`, `affected_components?`, `lease_id?`
- [ ] `CreateChangeResponse` 类型包含 `current_stage`
- [ ] `createChange()` 函数正确调用 `POST /api/workspaces/{id}/changes/create`
- [ ] `executeChange()` 函数正确调用 `POST /api/workspaces/{id}/changes/{changeKey}/execute`
- [ ] `npm run build` 无类型错误
- [ ] 不影响 `changes.ts` 中已有的导出函数

## 文件清单

| 文件 | 操作 |
|------|------|
| `frontend/src/lib/changes.ts` | 修改 — 新增类型 + createChange() + executeChange() |
