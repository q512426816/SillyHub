---
id: task-05
title: "Frontend API层 — changes.ts新增3个函数 + TypeScript类型定义"
priority: P0
estimated_hours: 1
depends_on:
  - task-04
blocks:
  - task-06
  - task-07
allowed_paths:
  - frontend/src/lib/changes.ts
---

# Task-05: Frontend API层 — changes.ts新增3个函数

## 背景

本任务在前端 API 层 `changes.ts` 中新增 3 个函数，对应 task-04 中后端新增的 3 个 REST 端点。这 3 个函数是后续 task-06（工作流 UI 页面）和 task-07（StageBadge 组件 + 列表页）的直接依赖——所有前端工作流交互均通过本任务的函数发起 HTTP 请求。

三个函数分别对应：
- **`transitionChange()`** → `POST /api/workspaces/{wid}/changes/{cid}/transition` — 阶段流转
- **`submitFeedback()`** → `POST /api/workspaces/{wid}/changes/{cid}/feedback` — 提交反馈
- **`checkArchiveGate()`** → `GET /api/workspaces/{wid}/changes/{cid}/archive-gate` — 归档门禁检查

## 修改文件

| 文件 | 操作 | 说明 |
|------|------|------|
| `frontend/src/lib/changes.ts` | 修改 | 新增 4 个 TypeScript 类型 + 3 个 API 函数 |

## 实现要求

### 1. 新增 TypeScript 类型定义

在文件中现有类型定义之后（`ChangeReparseResponse` 之后、`CreateChangeInput` 之前）新增以下类型：

```typescript
// ── Workflow Types (task-05) ────────────────────────────────────────────

/** 阶段流转请求参数 */
export type TransitionRequest = {
  /** 目标阶段，对应后端 StageEnum 值 */
  target_stage: string;
  /** 流转原因（可选） */
  reason?: string;
};

/** 反馈提交请求参数 */
export type FeedbackRequest = {
  /** 反馈类别: A=Bug, B=设计错误, C=信息不足, D=衍生新change */
  category: string;
  /** 反馈内容 */
  text: string;
};

/** 归档门禁单项检查结果 */
export type ArchiveCheckItem = {
  /** 检查项名称 */
  check: string;
  /** 未通过时的说明信息 */
  message: string;
};

/** 归档门禁检查响应 */
export type ArchiveGateResponse = {
  /** 是否全部通过，可执行归档 */
  can_archive: boolean;
  /** 未通过的检查项列表 */
  failed_checks: ArchiveCheckItem[];
};
```

> **类型映射说明**：以上类型与 task-03 后端 Pydantic DTO 对应——
> - `TransitionRequest` ↔ 后端 `TransitionRequest(stage, reason?)`
> - `FeedbackRequest` ↔ 后端 `FeedbackRequest(category, text, target_stage?)`（前端不传 `target_stage`，由后端根据 category 自动决定）
> - `ArchiveGateResponse` ↔ 后端 `ArchiveGateResponse(can_archive, checks[])`，但 API 响应中使用 `failed_checks` 字段名（仅包含未通过项），见设计文档 §5 API 响应示例

### 2. 新增 `transitionChange()` 函数

在文件末尾（`executeChange()` 函数之后）新增：

```typescript
/**
 * 阶段流转 — POST /api/workspaces/{wid}/changes/{cid}/transition
 *
 * 将 change 从当前阶段流转到 target_stage。
 * 后端会校验 TRANSITIONS 合法性和角色权限。
 */
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
  return apiFetch<ChangeRead>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    {
      method: "POST",
      json: body,
    },
  );
}
```

**设计要点**：
- 返回类型为 `ChangeRead`——后端流转成功后返回更新后的完整 change 对象，前端可直接用返回值更新本地状态
- `reason` 参数可选：仅在某些流转场景下需要（如退回时说明原因），调用方可根据上下文决定是否传入
- 路径使用 `changeId`（UUID）而非 `changeKey`——与后端 task-04 router 端点路径一致

### 3. 新增 `submitFeedback()` 函数

```typescript
/**
 * 提交反馈 — POST /api/workspaces/{wid}/changes/{cid}/feedback
 *
 * 在 technical_verification 或 business_review 阶段提交反馈。
 * 后端根据 category 自动决定返工目标阶段，并触发 rework_required 流转。
 */
export function submitFeedback(
  workspaceId: string,
  changeId: string,
  category: string,
  text: string,
) {
  return apiFetch<ChangeRead>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/feedback`,
    {
      method: "POST",
      json: { category, text } satisfies FeedbackRequest,
    },
  );
}
```

**设计要点**：
- 返回类型同样为 `ChangeRead`——后端接收反馈后会自动流转至 `rework_required`，再根据 category 路由到目标阶段，返回更新后的 change
- `category` 合法值为 `"A"` | `"B"` | `"C"` | `"D"`，但前端不做枚举约束（由后端 Pydantic `pattern=r"^[A-D]$"` 校验），保持与后端 schema 定义一致
- `text` 为必填——后端 Pydantic 定义 `min_length=1`，空反馈无意义
- 使用 `satisfies FeedbackRequest` 确保传入对象符合类型定义

### 4. 新增 `checkArchiveGate()` 函数

```typescript
/**
 * 归档门禁检查 — GET /api/workspaces/{wid}/changes/{cid}/archive-gate
 *
 * 检查 change 是否满足归档的前置条件（6 项检查）。
 * 返回 can_archive 标志和未通过项列表。
 */
export function checkArchiveGate(workspaceId: string, changeId: string) {
  return apiFetch<ArchiveGateResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive-gate`,
  );
}
```

**设计要点**：
- 使用 GET 方法——这是一个只读检查操作，不修改任何状态
- 返回 `ArchiveGateResponse`——`can_archive` 为 `true` 时 `failed_checks` 为空数组，前端可直接据此判断是否允许归档
- 无额外参数——所有检查项由后端根据 change ID 自动查询关联数据（PR、CI、文档等）

### 5. 保留现有代码

**所有已有函数和类型保持不变**，包括：
- 类型：`ChangeSummary`, `ChangeRead`, `ChangeList`, `ChangeDocMatrixEntry`, `ChangeDocMatrix`, `ChangeDocContent`, `ChangeWarning`, `ChangeReparseStats`, `ChangeReparseResponse`, `CreateChangeInput`, `CreateChangeResponse`
- 函数：`listChanges`, `getChange`, `getChangeDocuments`, `getChangeDocumentContent`, `reparseChanges`, `getChangeApproval`, `approveChange`, `rejectChange`, `updateChangeProgress`, `createChange`, `executeChange`

> 本次变更为纯追加操作，不修改任何现有代码。

## 接口定义

### 模块级公开 API

| 符号 | 类型 | 签名 | 说明 |
|------|------|------|------|
| `TransitionRequest` | type | `{ target_stage: string; reason?: string }` | 流转请求参数类型 |
| `FeedbackRequest` | type | `{ category: string; text: string }` | 反馈请求参数类型 |
| `ArchiveCheckItem` | type | `{ check: string; message: string }` | 门禁单项检查结果 |
| `ArchiveGateResponse` | type | `{ can_archive: boolean; failed_checks: ArchiveCheckItem[] }` | 门禁检查响应 |
| `transitionChange` | function | `(workspaceId, changeId, targetStage, reason?) → Promise<ChangeRead>` | 阶段流转 |
| `submitFeedback` | function | `(workspaceId, changeId, category, text) → Promise<ChangeRead>` | 提交反馈 |
| `checkArchiveGate` | function | `(workspaceId, changeId) → Promise<ArchiveGateResponse>` | 归档门禁检查 |

### HTTP 请求映射

| 函数 | Method | Path | Request Body | Response |
|------|--------|------|-------------|----------|
| `transitionChange` | POST | `/api/workspaces/{wid}/changes/{cid}/transition` | `TransitionRequest` | `ChangeRead` |
| `submitFeedback` | POST | `/api/workspaces/{wid}/changes/{cid}/feedback` | `FeedbackRequest` | `ChangeRead` |
| `checkArchiveGate` | GET | `/api/workspaces/{wid}/changes/{cid}/archive-gate` | — | `ArchiveGateResponse` |

## 边界处理

1. **`transitionChange` 的 `reason` 为空字符串**：函数仅在 `reason !== undefined` 时才将其序列化到请求体中，空字符串 `""` 会被发送到后端（后端可接受空字符串，因为 Pydantic 定义中 `reason` 类型为 `str | None`）。如果调用方不希望发送空字符串，应显式传 `undefined` 而非 `""`。
2. **`submitFeedback` 的 `category` 非法值**：前端不做枚举校验，直接透传给后端。后端 Pydantic `pattern=r"^[A-D]$"` 会返回 422 Validation Error，前端 `apiFetch` 会抛出 `ApiError(422, ...)`，调用方通过 try/catch 处理。
3. **`submitFeedback` 的 `text` 为空**：同样透传给后端。后端 `min_length=1` 约束会拦截，返回 422。前端函数签名要求 `text: string`（TypeScript 编译期排除 `undefined`），但空字符串 `""` 不被 TypeScript 拦截，需调用方 UI 层做输入校验。
4. **`checkArchiveGate` 在非 `accepted` 阶段调用**：后端会返回 409 Conflict（仅 `accepted` 阶段可检查归档门禁），前端 `apiFetch` 抛出 `ApiError(409, ...)`。前端不在函数层做阶段校验，由调用方 UI 层控制按钮可见性。
5. **网络错误与超时**：`apiFetch` 内部已统一处理网络异常（抛出 `ApiError(0, { code: "network_error" })`）和 HTTP 错误状态码。三个函数不额外包装 try/catch，由调用方自行处理。
6. **`checkArchiveGate` 的 `failed_checks` 为空数组**：当 `can_archive` 为 `true` 时，`failed_checks` 为 `[]`。前端展示时需处理此空数组情况，避免对空数组渲染列表项。

## 非目标

- ❌ 不新增 `StageEnum` 前端枚举（属于 task-06/07 UI 层的职责）
- ❌ 不实现 UI 组件（StageBadge、流转按钮、反馈表单等，属于 task-06/07）
- ❌ 不修改现有函数签名或返回类型
- ❌ 不添加请求重试逻辑（`apiFetch` 已有 401 token 刷新重试）
- ❌ 不添加前端缓存或状态管理（由调用方 / React Query 层处理）
- ❌ 不添加 WebSocket 实时推送（不在本次范围内）

## TDD 步骤

### Red → Green 循环

| # | 测试用例 | 类型 | 预期结果 |
|---|---------|------|---------|
| 1 | `test_transition_request_type` — 验证 `TransitionRequest` 类型结构包含 `target_stage: string` 和可选 `reason?: string` | 类型测试 | TypeScript 编译通过 |
| 2 | `test_feedback_request_type` — 验证 `FeedbackRequest` 类型结构包含 `category: string` 和 `text: string` | 类型测试 | TypeScript 编译通过 |
| 3 | `test_archive_gate_response_type` — 验证 `ArchiveGateResponse` 结构包含 `can_archive: boolean` 和 `failed_checks: ArchiveCheckItem[]` | 类型测试 | TypeScript 编译通过 |
| 4 | `test_transition_change_sends_post` — mock `fetch`，调用 `transitionChange("ws1", "ch1", "design_review")`，验证请求 method 为 POST、path 包含 `/transition`、body 为 `{ target_stage: "design_review" }` | 单元测试 | 请求参数匹配 |
| 5 | `test_transition_change_with_reason` — 调用 `transitionChange("ws1", "ch1", "clarifying", "需求不明确")`，验证 body 包含 `reason` 字段 | 单元测试 | body 为 `{ target_stage: "clarifying", reason: "需求不明确" }` |
| 6 | `test_transition_change_without_reason` — 调用 `transitionChange("ws1", "ch1", "in_dev")`（不传 reason），验证 body 不含 `reason` 字段 | 单元测试 | body 为 `{ target_stage: "in_dev" }` |
| 7 | `test_transition_change_returns_change_read` — mock 返回完整 ChangeRead 对象，验证返回值类型正确 | 单元测试 | 返回 `ChangeRead` 结构 |
| 8 | `test_submit_feedback_sends_post` — 调用 `submitFeedback("ws1", "ch1", "A", "实现与设计不符")`，验证请求 method 为 POST、path 包含 `/feedback`、body 为 `{ category: "A", text: "实现与设计不符" }` | 单元测试 | 请求参数匹配 |
| 9 | `test_submit_feedback_returns_change_read` — mock 返回 ChangeRead（stage 已变更），验证返回值正确 | 单元测试 | 返回 `ChangeRead` 结构 |
| 10 | `test_check_archive_gate_sends_get` — 调用 `checkArchiveGate("ws1", "ch1")`，验证请求 method 为 GET（非 POST）、path 包含 `/archive-gate`、无 body | 单元测试 | method 为 GET，无 json body |
| 11 | `test_check_archive_gate_pass` — mock 返回 `{ can_archive: true, failed_checks: [] }`，验证返回值结构 | 单元测试 | `can_archive === true`，`failed_checks.length === 0` |
| 12 | `test_check_archive_gate_fail` — mock 返回 `{ can_archive: false, failed_checks: [{ check: "prs_merged", message: "PR #42 仍为 open" }] }`，验证解析正确 | 单元测试 | `can_archive === false`，`failed_checks[0].check === "prs_merged"` |
| 13 | `test_existing_functions_unchanged` — 验证 `listChanges`, `getChange`, `createChange`, `executeChange` 等函数仍可正常调用 | 回归测试 | 所有现有函数行为不变 |
| 14 | `test_transition_change_handles_422` — mock 后端返回 422（非法 target_stage），验证抛出 `ApiError` 且 `status === 422` | 错误测试 | `error.status === 422` |
| 15 | `test_submit_feedback_handles_422_invalid_category` — mock 后端返回 422（category 不匹配 `^[A-D]$`），验证抛出 `ApiError` | 错误测试 | `error.status === 422` |
| 16 | `test_check_archive_gate_handles_409` — mock 后端返回 409（非 accepted 阶段），验证抛出 `ApiError` | 错误测试 | `error.status === 409` |

### 执行顺序

```
1. 先写 test_transition_request_type / test_feedback_request_type / test_archive_gate_response_type
   → 新增 4 个 TypeScript 类型 → Green（编译通过）
2. 再写 test_transition_change_* → 实现 transitionChange() → Green
3. 再写 test_submit_feedback_* → 实现 submitFeedback() → Green
4. 再写 test_check_archive_gate_* → 实现 checkArchiveGate() → Green
5. 写 test_existing_functions_unchanged → 确认无回归
6. 写错误处理测试 → 确认 ApiError 抛出正确
7. 全量跑通确认
```

## 验收标准

| # | 标准 | 验证方法 |
|---|------|---------|
| AC-1 | `TransitionRequest` 类型定义正确，包含 `target_stage: string` 和可选 `reason?: string` | TypeScript 编译无错误，IDE 类型提示正确 |
| AC-2 | `FeedbackRequest` 类型定义正确，包含 `category: string` 和 `text: string` | TypeScript 编译无错误 |
| AC-3 | `ArchiveGateResponse` 类型定义正确，包含 `can_archive: boolean` 和 `failed_checks: ArchiveCheckItem[]` | TypeScript 编译无错误 |
| AC-4 | `transitionChange()` 发送 POST 请求至正确路径，body 序列化正确，返回 `Promise<ChangeRead>` | 单元测试 mock fetch 验证请求参数 |
| AC-5 | `submitFeedback()` 发送 POST 请求至正确路径，body 包含 `category` 和 `text`，返回 `Promise<ChangeRead>` | 单元测试 mock fetch 验证 |
| AC-6 | `checkArchiveGate()` 发送 GET 请求（无 body），返回 `Promise<ArchiveGateResponse>` | 单元测试验证 method 为 GET |
| AC-7 | `transitionChange` 不传 `reason` 时 body 中不含 `reason` 字段；传入时包含 | 单元测试验证两种情况 |
| AC-8 | 后端返回 4xx 错误时，三个函数均通过 `apiFetch` 抛出 `ApiError` | 单元测试 mock 422/409 响应 |
| AC-9 | 所有现有函数（`listChanges`, `getChange` 等 11 个）行为不受影响 | 现有前端测试全量通过 |
| AC-10 | 新增代码无新外部依赖引入，仅使用已有的 `apiFetch` | `git diff` 确认无新 import |
| AC-11 | `npx tsc --noEmit` 编译通过，无类型错误 | CI TypeScript 检查通过 |
