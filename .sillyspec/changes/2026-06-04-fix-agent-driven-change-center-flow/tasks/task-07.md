---
id: task-07
title: "Gate 面板加 comment textarea + 修 archive-confirm 按钮 + 清理旧 UI 残留"
priority: P0
estimated_hours: 3
depends_on: [task-03, task-04, task-05, task-06]
blocks: [task-08]
author: WhaleFall
created_at: 2026-06-04 13:50:10
---

# task-07: 前端 Gate 面板修正

## 修改文件

| 文件 | 改动 |
|------|------|
| `frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx` | Gate 面板加 comment textarea；修 need_archive_confirm 按钮 action；清理旧 UI 残留 |
| `frontend/src/lib/changes.ts` | 新增 `archiveConfirm()` API 函数 |

## 实现要求

### 1. Gate 面板 comment textarea

在 `GATE_PANELS` 配置中为每个 gate type 添加 `placeholder` 字段，并在 Gate 面板渲染区域添加 `<textarea>`。

**GATE_PANELS 扩展**：为每个 gate 条目添加 `comment_placeholder` 字段：

| gate | comment_placeholder |
|------|---------------------|
| `need_requirement_input` | `"补充需求背景"` |
| `need_proposal_review` | `"不通过时说明哪里需要修改"` |
| `need_plan_review` | `"不通过时说明计划哪里不合理"` |
| `need_human_test` | `"发现BUG或文档不符时填写详情"` |
| `need_archive_confirm` | `"归档备注，可选"` |
| `blocked` | `null`（无 textarea） |

**Textarea 渲染位置**：在 Gate 面板的 `actions` 按钮行上方插入 `<textarea>`。仅当 `comment_placeholder !== null` 时渲染。

**Textarea 规格**：
- 绑定到组件级 state `gateComment`（新增 `useState<string>("")`）
- `rows={2}`，`maxLength={2000}`
- 样式与现有反馈 textarea 一致：`w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none`
- 在 gate 切换时清空（每次 `handleGateAction` 成功后 `setGateComment("")`）

### 2. Comment 校验规则

根据 gate action 决定 comment 是否必填：

**必填 comment 的 action**：
- `proposal_revise`（revise）
- `proposal_unclear`（unclear）
- `plan_replan`（replan）
- `plan_back_to_propose`（back_to_propose）
- `plan_back_to_brainstorm`（back_to_brainstorm）
- `test_bug`（bug）
- `test_doc_mismatch`（doc_mismatch）

**允许空 comment 的 action**：
- `proposal_approve`（approve）
- `plan_approve`（approve）
- `test_pass`（pass）
- `archive_confirm`（archive-confirm）

**实现方式**：在 `handleGateAction` 开头新增校验逻辑：

```typescript
const ACTIONS_REQUIRING_COMMENT = new Set([
  "proposal_revise", "proposal_unclear",
  "plan_replan", "plan_back_to_propose", "plan_back_to_brainstorm",
  "test_bug", "test_doc_mismatch",
]);

if (ACTIONS_REQUIRING_COMMENT.has(action) && !gateComment.trim()) {
  setPageError("请填写说明后再提交");
  return;
}
```

### 3. 传 comment 到 review API 调用

修改 `handleGateAction` 中的每个 API 调用，传入 `gateComment || undefined`：

- `proposalReview(workspaceId, changeId, "approve", gateComment || undefined)`
- `proposalReview(workspaceId, changeId, "revise", gateComment || undefined)`
- `proposalReview(workspaceId, changeId, "unclear", gateComment || undefined)`
- `planReview(workspaceId, changeId, "approve", gateComment || undefined)`
- `planReview(workspaceId, changeId, "replan", gateComment || undefined)`
- `planReview(workspaceId, changeId, "back_to_propose", gateComment || undefined)`
- `planReview(workspaceId, changeId, "back_to_brainstorm", gateComment || undefined)`
- `humanTest(workspaceId, changeId, "pass", gateComment || undefined)`
- `humanTest(workspaceId, changeId, "bug", gateComment || undefined)`
- `humanTest(workspaceId, changeId, "doc_mismatch", gateComment || undefined)`

### 4. 修正 need_archive_confirm 按钮

当前 `need_archive_confirm` 的 action 是 `"test_pass"`，这会错误调用 `humanTest("pass")`。

**修正**：
1. 将 GATE_PANELS 中 `need_archive_confirm` 的 action 改为 `"archive_confirm"`
2. 在 `handleGateAction` 中添加新分支：

```typescript
else if (action === "archive_confirm") {
  await archiveConfirm(workspaceId, changeId, gateComment || undefined);
}
```

### 5. 新增 archiveConfirm API 函数

在 `frontend/src/lib/changes.ts` 中新增：

```typescript
export function archiveConfirm(
  workspaceId: string,
  changeId: string,
  comment?: string,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive-confirm`,
    {
      method: "POST",
      json: { comment: comment ?? null },
    },
  );
}
```

此函数对齐 task-06 新增的 `POST /changes/{id}/archive-confirm` 端点。

### 6. 清理旧 UI 残留

以下内容需从 `page.tsx` 中删除或清理：

**删除**：
1. `ready_for_dev` 相关 UI：第 631-639 行的 `change.current_stage === "ready_for_dev"` 启动执行按钮块（Agent dispatch 已由 gate 流程自动处理）
2. `accepted` 阶段归档门禁 UI：第 963-1019 行的 `change.current_stage === "accepted"` 归档门禁 section（归档确认已由 need_archive_confirm gate 面板取代）
3. `handleArchive` 函数（第 442-455 行）及其关联 state（`archiving`、`archiveGate`、`loadingArchiveGate`）
4. `loadArchiveGate` 函数（第 402-412 行）
5. `accepted` stage 的 useEffect 自动加载归档门禁（第 458-463 行）
6. `handleSubmitReview` 函数（第 306-318 行）和 `reviewComment` state（已被 gate comment 取代）
7. 侧边栏的"提交审查"section（第 1093-1121 行）：`["proposed", "reviewed"].includes(change.status)` 条件渲染的审批块
8. `rejectionInput` / `showRejectInput` state 及 `handleApprove` / `handleReject` 函数（第 196-198, 322-350 行）：旧审批流程 UI
9. 侧边栏的"审批状态"section（第 827-893 行）：旧审批流程展示

**清理 import**：
- 移除未使用的 import：`approveChange`、`rejectChange`、`submitFeedback`、`checkArchiveGate`
- 移除未使用的 import：`submitReview`、`listReviews`（如果 reviews 列表展示也一并移除）
- 保留：`proposalReview`、`planReview`、`humanTest`（gate 面板使用）
- 保留：`getChange`、`getChangeDocuments`、`getChangeDocumentContent`、`getAgentStatus`、`triggerDispatch`（核心功能）

**保留**：
- `feedbackCategory` / `feedbackText` / `submittingFeedback` state 和 `handleSubmitFeedback` 函数：technical_verification / business_review 阶段的反馈功能暂保留（后续可独立清理）
- `reviews` state 和审查记录展示：保留展示历史 review 记录的能力

**注意**：清理 import 时需同步检查 `from "@/lib/workflow"` 的 `submitReview`、`listReviews`、`transitionChange`、`ReviewEntry`。`transitionChange` 在 `transition_execute` action 中仍被使用，保留。

## 接口定义

### 新增 archiveConfirm（前端 API 函数）

```typescript
// frontend/src/lib/changes.ts

export function archiveConfirm(
  workspaceId: string,
  changeId: string,
  comment?: string,
): Promise<ReviewResponse>
```

- 请求：`POST /api/workspaces/{workspaceId}/changes/{changeId}/archive-confirm`
- 请求体：`{ comment: string | null }`
- 响应：`ReviewResponse`（复用现有类型）
- 前置条件（后端保证）：`current_stage == "archive" && human_gate == "need_archive_confirm"`

### 现有 review API 调用（无签名变更）

`proposalReview`、`planReview`、`humanTest` 已接受可选 `comment` 参数，无需修改签名。

## 边界处理

| # | 边界场景 | 处理方式 |
|---|----------|----------|
| 1 | 必填 comment 的 action 未填 comment | `handleGateAction` 入口拦截，`setPageError("请填写说明后再提交")`，不发送 API 请求 |
| 2 | archiveConfirm 被非 archive+need_archive_confirm 状态调用 | 后端 guard 拒绝，前端展示 `err.message` 错误信息 |
| 3 | Gate 面板操作成功后旧 comment 残留 | `handleGateAction` 成功后 `setGateComment("")`，页面刷新后 textarea 清空 |
| 4 | 多个 change 切换时 gateComment 未清空 | `useEffect` 依赖 `[workspaceId, changeId]` 初始加载时不重置 gateComment，但因 change 切换触发页面重载（`setChange`），且 gate 面板每次重新渲染，视觉上无残留。为安全起见，在 changeId 变化时清空 gateComment |
| 5 | textarea 超过 2000 字符 | HTML `maxLength={2000}` 限制输入，无需额外校验 |
| 6 | 后端 archive-confirm API 未就绪（task-06 未完成） | 此任务 depends_on task-06，理论上 API 已存在。若不存在，API 调用失败，前端展示错误信息 |
| 7 | 旧 UI 代码引用了 `ready_for_dev` / `accepted` 阶段但实际不存在 | 清理代码时一并移除这些条件分支，避免死代码 |

## 非目标

- 不修改后端 API 签名或路由（task-03/04/05/06 负责）
- 不修改 `ArchiveGateResponse` 或归档门禁检查逻辑
- 不重构 `handleGateAction` 为独立组件（保持当前结构，后续可提取）
- 不修改 `SillySpecStepProgress` 组件
- 不处理 `blocked` gate 的 comment（blocked 只有 transition_execute 按钮，无需 comment）
- 不修改 `redispatch_brainstorm` action（need_requirement_input 阶段的重新分析，当前调用 `transitionChange`，后续可在 task-08 后独立处理）

## 参考

- design.md AD-04（pass 不 dispatch archive）、AD-05（archive-confirm API）
- plan.md Wave 4, task-07 描述
- `page.tsx` 第 64-114 行：GATE_PANELS 配置
- `page.tsx` 第 492-526 行：handleGateAction 当前实现
- `page.tsx` 第 602-622 行：Gate 面板渲染区域
- `page.tsx` 第 631-639 行：ready_for_dev 旧按钮（待删除）
- `page.tsx` 第 963-1019 行：accepted 归档门禁旧 UI（待删除）
- `page.tsx` 第 1093-1121 行：旧审查提交 UI（待删除）
- `changes.ts` 第 393-436 行：现有 review API 函数（proposalReview, planReview, humanTest）
- task-05 设计：human_test 三路分支（前端需匹配 bug/doc_mismatch/pass action）
- task-06 设计：archive-confirm API 端点

## TDD

### 测试用例列表

前端无独立单元测试（Next.js page route），通过以下方式验证：

| # | 验证项 | 方式 |
|---|--------|------|
| 1 | TypeScript 编译无错误 | `npx tsc --noEmit` |
| 2 | ESLint 无新增 warning | `npx eslint frontend/src/app/\\(dashboard\\)/workspaces/\\[id\\]/changes/\\[cid\\]/page.tsx` |
| 3 | archiveConfirm 函数签名正确 | 代码审查 + TypeScript 类型检查 |
| 4 | GATE_PANELS 每个 gate 都有 comment_placeholder | 代码审查 |
| 5 | 旧 UI 引用已清除（ready_for_dev / accepted 审批块） | 全局搜索 `ready_for_dev`、`accepted` 确认无残留 |

## 验收标准

| # | 标准 | 验证方式 |
|---|------|----------|
| 1 | Gate 面板显示 comment textarea（blocked 除外） | 手动验证：进入 propose 阶段触发 need_proposal_review gate，面板中有 textarea |
| 2 | need_proposal_review textarea placeholder 为 "不通过时说明哪里需要修改" | 手动验证 |
| 3 | need_archive_confirm 按钮 action 为 "archive_confirm"，调用 `archiveConfirm()` API | 代码审查 + 手动验证 |
| 4 | revise/unclear/replan/bug/doc_mismatch 等必填 comment 的 action 未填 comment 时，提示错误且不发请求 | 手动验证：不填 comment 点"需要修改"，应显示 "请填写说明后再提交" |
| 5 | approve/pass/archive-confirm 允许空 comment 提交 | 手动验证 |
| 6 | 所有 review API 调用都传入 gateComment | 代码审查 |
| 7 | `archiveConfirm` 函数在 `changes.ts` 中正确定义，请求路径和 body 格式正确 | 代码审查 + TypeScript 类型检查 |
| 8 | `ready_for_dev` 启动执行按钮已删除 | `grep -r "ready_for_dev" frontend/` 无结果 |
| 9 | 旧归档门禁 UI（accepted 阶段 section）已删除 | `grep -r "accepted" frontend/.../page.tsx` 确认无旧归档门禁残留 |
| 10 | 旧审批流程 UI（approve/reject 按钮和审批状态 section）已删除 | 代码审查 |
| 11 | 旧"提交审查"section（proposed/reviewed 状态）已删除 | 代码审查 |
| 12 | 无未使用的 import | `npx tsc --noEmit` 通过 |
| 13 | Gate 操作成功后 textarea 清空 | 手动验证 |
| 14 | gateComment 在 changeId 切换时清空 | 手动验证或代码审查 useEffect |
