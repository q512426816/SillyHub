---
author: qinyi
created_at: 2026-06-01 19:30:00
---

---
id: task-15
title: 修正前端 transitionChange 返回类型
priority: P1
estimated_hours: 1
depends_on: [task-13]
blocks: [task-16]
allowed_paths:
  - frontend/src/lib/changes.ts
---

## 修改文件

- `frontend/src/lib/changes.ts`

## 实现要求

根据 design.md Phase 6 "前端修正"（line 335-363）和 task-13 的后端 schema 定义：

1. 新增 `TransitionDispatchResponse` interface（对应后端 `TransitionDispatchResponse`）
2. 新增 `TransitionResponse` interface（对应后端 `TransitionResponse`）
3. 修改 `transitionChange()` 函数的 `apiFetch` 泛型参数从 `ChangeRead` 改为 `TransitionResponse`

## 接口定义

在 `frontend/src/lib/changes.ts` 的 `// ── Agent Dispatch Types` 段落（line 311 附近）之后、`DispatchResult` type 之前，新增以下两个 interface：

```typescript
/** Transition 专用的 agent dispatch 结果（对应后端 TransitionDispatchResponse） */
export type TransitionDispatchResponse = {
  /** 是否成功 dispatch 了 AgentRun */
  dispatched: boolean;
  /** AgentRun ID（dispatched=true 时有值） */
  agent_run_id: string | null;
  /** 目标 SillySpec 阶段 */
  stage: string | null;
  /** 未 dispatch 的原因（dispatched=false 时有值） */
  reason: string | null;
};

/** POST /changes/{id}/transition 的返回类型（对应后端 TransitionResponse） */
export type TransitionResponse = {
  /** 变更数据（ChangeRead 的 dict 表示） */
  change: ChangeRead;
  /** Agent dispatch 结果（无 dispatch 时为 null） */
  agent_dispatch: TransitionDispatchResponse | null;
};
```

然后修改 `transitionChange()` 函数（当前在 line 259-276），将 `apiFetch<ChangeRead>` 改为 `apiFetch<TransitionResponse>`：

```typescript
export function transitionChange(
  workspaceId: string,
  changeId: string,
  targetStage: string,
  reason?: string,
) {
  const body: TransitionRequest = { target_stage: targetStage };
  if (reason !== undefined) {
    body.reason = reason;
  }
  return apiFetch<TransitionResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    {
      method: "POST",
      json: body,
    },
  );
}
```

### 命名说明

前端使用 `TransitionDispatchResponse` 而非 design.md 中的 `DispatchResponse`，原因与后端 task-13 一致：当前 `changes.ts` 已有 `DispatchResponse` type（line 323），被 `getAgentStatus()` 和 `triggerDispatch()` 使用，字段结构完全不同（`change_id`、`current_stage`、`has_active_run`、`config_enabled`、`last_dispatch`）。重用同名会导致类型冲突和语义混淆。

## 边界处理

1. **agent_dispatch 可能为 null**：后端 `TransitionResponse.agent_dispatch` 为 `TransitionDispatchResponse | None`，序列化为 JSON `null`。前端通过 `TransitionDispatchResponse | null` 匹配，调用方需 `if (res.agent_dispatch)` 守卫。
2. **agent_run_id 可能为 null**：当 `dispatched=false` 时 `agent_run_id` 为 `null`。前端不应通过此字段判断 dispatch 状态，应优先检查 `dispatched` 布尔值。
3. **stage 可能为 null**：后端 `TransitionDispatchResponse.stage` 有默认值 `None`，前端对应 `string | null`，调用方需处理 null 情况。
4. **change 字段结构与 ChangeRead 一致**：后端返回 `dict[str, Any]`，但结构对应 `ChangeRead` 的所有字段。前端 `TransitionResponse.change` 类型声明为 `ChangeRead`，`apiFetch` 的泛型推断会确保类型正确。如果后端返回结构与 `ChangeRead` 不完全匹配（例如缺少可选字段），TypeScript 运行时不报错但类型不安全——依赖后端契约保证一致性。
5. **现有 DispatchResponse 不受影响**：`getAgentStatus()` 和 `triggerDispatch()` 继续使用原有 `DispatchResponse` type，新增 `TransitionDispatchResponse` 不产生命名冲突。
6. **reason 可能为 null**：当 `dispatched=true` 时 `reason` 为 `null`。前端展示时需判断 `dispatched` 再决定显示 `reason` 还是 `agent_run_id`。
7. **向后兼容**：`transitionChange()` 返回类型从 `ChangeRead` 变为 `TransitionResponse`，调用方需要通过 `.change` 访问变更数据。此为 breaking change，但 task-16 会同步更新变更详情页的调用方代码。

## 非目标

- 不修改 UI 组件（task-16 负责更新变更详情页展示）
- 不修改 `DispatchResponse` type（被 agent-status / dispatch 端点使用）
- 不修改后端代码
- 不修改 `submitFeedback()`、`checkArchiveGate()` 等其他 API 函数

## 参考

- design.md Phase 6 "前端修正"（line 335-363）
- task-13 的后端 TransitionResponse schema 定义
- `frontend/src/lib/changes.ts` 现有 `transitionChange()` 函数（line 259-276）
- `frontend/src/lib/changes.ts` 现有 `DispatchResponse` type（line 323-329）

## TDD 步骤

TypeScript 编译即验证，无需额外测试框架：

1. **修改前**：确认 `tsc --noEmit` 当前编译通过（基线）
2. **新增类型**：在 `changes.ts` 中添加 `TransitionDispatchResponse` 和 `TransitionResponse` type
3. **修改返回类型**：`transitionChange()` 的 `apiFetch` 泛型改为 `TransitionResponse`
4. **验证编译**：`npx tsc --noEmit` 无错误
5. **验证向后兼容**：确认 `getAgentStatus()` 和 `triggerDispatch()` 仍使用原有 `DispatchResponse`

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | TypeScript 编译 | `npx tsc --noEmit` 在 frontend 目录下无错误 |
| AC-02 | `TransitionDispatchResponse` 类型定义正确 | 包含 `dispatched: boolean`、`agent_run_id: string \| null`、`stage: string \| null`、`reason: string \| null` 四个字段 |
| AC-03 | `TransitionResponse` 类型定义正确 | 包含 `change: ChangeRead` 和 `agent_dispatch: TransitionDispatchResponse \| null` 两个字段 |
| AC-04 | `transitionChange()` 返回类型为 `TransitionResponse` | `apiFetch<TransitionResponse>` 泛型参数正确 |
| AC-05 | 原有 `DispatchResponse` 不受影响 | `getAgentStatus()` 和 `triggerDispatch()` 仍使用原有 `DispatchResponse` type |
| AC-06 | 无命名冲突 | `TransitionDispatchResponse` 与 `DispatchResponse` 共存，TypeScript 不报重复标识符错误 |
